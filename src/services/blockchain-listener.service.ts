import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import * as crypto from 'crypto';

/**
 * BlockchainListenerService
 *
 * Monitors all 4 blockchains for deposits to user addresses
 * Sends webhook to Laravel when deposits are detected
 *
 * Each network uses different monitoring method:
 * - Tron: HTTP polling
 * - Ethereum: WebSocket block subscriptions
 * - Bitcoin: UTXO polling
 * - Solana: WebSocket account subscriptions
 */
@Injectable()
export class BlockchainListenerService {
  private laravelWebhookUrl: string;
  private laravelApiSecret: string;

  // RPC endpoints
  private tronRpc: string;
  private tronApiKey: string;
  private ethereumRpc: string;
  private bitcoinRpc: string;
  private solanaRpc: string;

  // Providers
  private ethProvider: ethers.WebSocketProvider;
  private solanaConnection: Connection;

  // Tracking processed transactions (to avoid duplicates)
  private processedTxs: Set<string> = new Set();

  // Track last processed block for each network (for catch-up logic)
  private lastProcessedBlock: {
    ethereum: number;
    bitcoin: number;
  } = {
    ethereum: 0,
    bitcoin: 0,
  };

  constructor(private configService: ConfigService) {
    this.laravelWebhookUrl = this.configService.get('LARAVEL_URL') + '/api/webhooks/deposit';
    this.laravelApiSecret = this.configService.get('LARAVEL_API_SECRET');

    // RPC URLs
    this.tronRpc = this.configService.get('TRON_MAINNET_RPC', 'https://api.trongrid.io');
    this.tronApiKey = this.configService.get('TRON_API_KEY', '');
    this.ethereumRpc = this.configService.get('ETH_MAINNET_RPC', 'wss://eth-mainnet.g.alchemy.com/v2/your-api-key');
    this.bitcoinRpc = this.configService.get('BTC_MAINNET_RPC', 'https://blockstream.info/api');
    this.solanaRpc = this.configService.get('SOLANA_MAINNET_RPC', 'https://api.mainnet-beta.solana.com');
  }

  // ==================== TRON LISTENER ====================

  /**
   * Monitor Tron blockchain for deposits
   * Method: HTTP polling every 5 minutes
   */
  async startTronListener(addresses: Array<{ user_id: number; address: string }>) {
    console.log('🔍 Starting Tron deposit listener...');
    console.log(`Monitoring ${addresses.length} Tron addresses`);

    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    while (true) {
      try {
        for (const addr of addresses) {
          await this.checkTronDeposits(addr.user_id, addr.address);
        }

        consecutiveErrors = 0; // Reset error counter on success
        await this.sleep(300000); // Check every 5 minutes
      } catch (error) {
        consecutiveErrors++;
        console.error(`❌ Tron listener error (${consecutiveErrors}/${maxConsecutiveErrors}):`, error.message);

        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.error('💡 Please check your TRON_MAINNET_RPC URL and API credentials');
          console.log('🔄 Continuing to retry every 5 minutes...');
        }

        await this.sleep(300000); // Wait 5 minutes before retry
      }
    }
  }

  private async checkTronDeposits(userId: number, address: string) {
    try {
      // Query TronGrid API for transactions
      const response = await axios.get(
        `${this.tronRpc}/v1/accounts/${address}/transactions`,
        {
          params: {
            limit: 20,
            // Note: order_by is not supported by TronGrid v1 API
            // Results are returned in descending order by default
          },
          headers: {
            'TRON-PRO-API-KEY': this.tronApiKey,
          },
          timeout: 30000, // 30 second timeout
        },
      );

      const transactions = response.data.data || [];

      for (const tx of transactions) {
        const txHash = tx.txID;

        // Skip if already processed
        if (this.processedTxs.has(txHash)) continue;

        // Check if incoming transaction (now async)
        const isIncoming = await this.isTronIncoming(tx, address);
        if (isIncoming) {
          const deposit = await this.parseTronTransaction(tx, userId, address);
          if (deposit && deposit.amount > 0) {
            await this.notifyLaravelDeposit(deposit);
            this.processedTxs.add(txHash);
          }
        }
      }
    } catch (error) {
      if (error.response?.status === 401) {
        throw new Error('Tron API authentication failed - check your API key');
      } else if (error.code === 'ECONNREFUSED') {
        throw new Error('Cannot connect to Tron RPC - check your network connection');
      } else if (error.code === 'ETIMEDOUT') {
        console.error(`⚠️ Tron API timeout for ${address} - will retry next cycle`);
      } else {
        throw error;
      }
    }
  }

  private async isTronIncoming(tx: any, address: string): Promise<boolean> {
    const contract = tx.raw_data?.contract?.[0];

    if (!contract) return false;

    // Check native TRX transfers
    if (contract.type === 'TransferContract') {
      const toAddress = contract.parameter?.value?.to_address;
      if (toAddress && this.tronHexToBase58(toAddress) === address) {
        return true;
      }
    }

    // Check TRC20 token transfers
    if (contract.type === 'TriggerSmartContract') {
      // TRC20 Transfer event logs are in transaction info
      const txInfo = await this.getTronTransactionInfo(tx.txID);

      if (txInfo?.log && txInfo.log.length > 0) {
        // Parse Transfer event: Transfer(address indexed from, address indexed to, uint256 value)
        for (const log of txInfo.log) {
          // Transfer event topic: 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
          if (log.topics && log.topics[0] === 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
            // topics[2] is the 'to' address (indexed parameter)
            const toAddress = log.topics[2];
            if (toAddress && this.tronHexToBase58('41' + toAddress) === address) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  private async parseTronTransaction(tx: any, userId: number, address: string) {
    const contract = tx.raw_data.contract[0];
    const value = contract.parameter.value;

    // Get confirmations
    const currentBlock = await this.getTronCurrentBlock();
    const confirmations = currentBlock - tx.blockNumber;

    // Determine if TRX or TRC20
    let coinSymbol = 'TRX';
    let amount = 0;
    let tokenContract = null;

    if (contract.type === 'TransferContract') {
      // Native TRX transfer
      coinSymbol = 'TRX';
      amount = value.amount / 1e6; // Convert SUN to TRX
    } else if (contract.type === 'TriggerSmartContract') {
      // TRC20 token transfer
      const txInfo = await this.getTronTransactionInfo(tx.txID);

      if (txInfo?.log && txInfo.log.length > 0) {
        const transferLog = txInfo.log.find(
          log => log.topics && log.topics[0] === 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
        );

        if (transferLog) {
          tokenContract = this.tronHexToBase58('41' + txInfo.contract_address);

          // Get token info (symbol, decimals)
          const tokenInfo = await this.getTRC20TokenInfo(tokenContract);
          coinSymbol = tokenInfo.symbol;

          // Decode amount from log data (uint256)
          const amountHex = transferLog.data;
          const amountBigInt = BigInt('0x' + amountHex);
          amount = Number(amountBigInt) / Math.pow(10, tokenInfo.decimals);
        }
      }
    }

    return {
      user_id: userId,
      network: 'tron',
      coin_symbol: coinSymbol,
      amount: amount,
      from_address: this.tronHexToBase58(value.owner_address || value.from),
      to_address: address,
      tx_hash: tx.txID,
      confirmations: confirmations,
      block_number: tx.blockNumber,
      timestamp: tx.block_timestamp,
      token_contract: tokenContract, // Add token contract for TRC20
    };
  }

  private async getTronTransactionInfo(txHash: string): Promise<any> {
    try {
      const response = await axios.post(
        `${this.tronRpc}/wallet/gettransactioninfobyid`,
        { value: txHash },
        {
          headers: {
            'TRON-PRO-API-KEY': this.tronApiKey,
            'Content-Type': 'application/json',
          },
        },
      );
      return response.data;
    } catch (error) {
      console.error('Error getting Tron transaction info:', error.message);
      return null;
    }
  }

  private async getTRC20TokenInfo(contractAddress: string): Promise<{ symbol: string; decimals: number }> {
    try {
      const headers = {
        'TRON-PRO-API-KEY': this.tronApiKey,
        'Content-Type': 'application/json',
      };

      // Call contract to get symbol
      const symbolResponse = await axios.post(
        `${this.tronRpc}/wallet/triggerconstantcontract`,
        {
          owner_address: '410000000000000000000000000000000000000000',
          contract_address: contractAddress,
          function_selector: 'symbol()',
          parameter: '',
        },
        { headers },
      );

      // Call contract to get decimals
      const decimalsResponse = await axios.post(
        `${this.tronRpc}/wallet/triggerconstantcontract`,
        {
          owner_address: '410000000000000000000000000000000000000000',
          contract_address: contractAddress,
          function_selector: 'decimals()',
          parameter: '',
        },
        { headers },
      );

      // Parse results
      const symbol = this.parseStringResult(symbolResponse.data?.constant_result?.[0]) || 'UNKNOWN';
      const decimals = this.parseIntResult(decimalsResponse.data?.constant_result?.[0]) || 6;

      return { symbol, decimals };
    } catch (error) {
      console.error('Error getting TRC20 token info:', error.message);
      // Default to USDT-like params if fetch fails
      return { symbol: 'UNKNOWN', decimals: 6 };
    }
  }

  private parseStringResult(hexResult: string): string {
    if (!hexResult) return '';
    try {
      // Decode hex string to UTF-8
      const buffer = Buffer.from(hexResult, 'hex');
      // Skip first 64 chars (ABI encoding offset + length)
      const symbolHex = buffer.slice(64).toString('hex').replace(/00/g, '');
      return Buffer.from(symbolHex, 'hex').toString('utf8');
    } catch (error) {
      return '';
    }
  }

  private parseIntResult(hexResult: string): number {
    if (!hexResult) return 0;
    try {
      return parseInt(hexResult, 16);
    } catch (error) {
      return 0;
    }
  }

  private async getTronCurrentBlock(): Promise<number> {
    const response = await axios.post(
      `${this.tronRpc}/wallet/getnowblock`,
      {},
      {
        headers: {
          'TRON-PRO-API-KEY': this.tronApiKey,
          'Content-Type': 'application/json',
        },
      },
    );
    return response.data.block_header.raw_data.number;
  }

  private tronHexToBase58(hexAddress: string): string {
    try {
      // Remove '0x' prefix if present
      let hex = hexAddress.replace(/^0x/, '');

      // Add '41' prefix if not present (mainnet prefix)
      if (!hex.startsWith('41')) {
        hex = '41' + hex;
      }

      // Convert hex to bytes
      const bytes = Buffer.from(hex, 'hex');

      // Calculate checksum (double SHA256)
      const crypto = require('crypto');
      const hash1 = crypto.createHash('sha256').update(bytes).digest();
      const hash2 = crypto.createHash('sha256').update(hash1).digest();
      const checksum = hash2.slice(0, 4);

      // Append checksum
      const addressWithChecksum = Buffer.concat([bytes, checksum]);

      // Encode to Base58
      return this.base58Encode(addressWithChecksum);
    } catch (error) {
      console.error('Error converting Tron hex to base58:', error.message);
      return hexAddress; // Return original if conversion fails
    }
  }

  private base58Encode(buffer: Buffer): string {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const base = BigInt(58);

    let num = BigInt('0x' + buffer.toString('hex'));
    let encoded = '';

    while (num > 0) {
      const remainder = Number(num % base);
      num = num / base;
      encoded = ALPHABET[remainder] + encoded;
    }

    // Add leading '1's for leading zeros
    for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
      encoded = '1' + encoded;
    }

    return encoded;
  }

  // ==================== ETHEREUM LISTENER ====================

  /**
   * Monitor Ethereum blockchain for deposits
   * Method: WebSocket subscriptions for real-time detection
   */
  async startEthereumListener(addresses: Array<{ user_id: number; address: string }>) {
    console.log('🔍 Starting Ethereum deposit listener...');
    console.log(`Monitoring ${addresses.length} Ethereum addresses`);

    try {
      // Create WebSocket provider
      this.ethProvider = new ethers.WebSocketProvider(this.ethereumRpc);

      // Create address to user_id mapping
      const addressMap = new Map(addresses.map((a) => [a.address.toLowerCase(), a.user_id]));

      // CRITICAL: Attach error handler IMMEDIATELY to prevent crashes
      // Access the underlying WebSocket via _websocket property
      const websocket = (this.ethProvider as any)._websocket || (this.ethProvider as any).websocket;

      if (websocket) {
        websocket.on('error', (error: any) => {
          console.error('❌ Ethereum WebSocket connection error:', error.message || error);
          console.log('🔄 Will attempt to reconnect in 30 seconds...');

          // Clean up old provider
          if (this.ethProvider) {
            try {
              this.ethProvider.removeAllListeners();
              this.ethProvider.destroy();
            } catch (e) {
              // Ignore cleanup errors
            }
          }

          // Reconnect after delay
          setTimeout(() => {
            console.log('🔄 Reconnecting Ethereum listener...');
            this.startEthereumListener(addresses);
          }, 30000);
        });

        websocket.on('close', (code: number) => {
          if (code !== 1000) {
            console.error(`❌ Ethereum WebSocket closed unexpectedly (code: ${code})`);
            console.log('🔄 Reconnecting in 30 seconds...');

            setTimeout(() => {
              this.startEthereumListener(addresses);
            }, 30000);
          }
        });
      }

      // Also handle provider-level errors
      this.ethProvider.on('error', (error) => {
        console.error('❌ Ethereum provider error:', error.message);
      });

      // Initialize last processed block if this is first run
      if (this.lastProcessedBlock.ethereum === 0) {
        const currentBlock = await this.ethProvider.getBlockNumber();
        this.lastProcessedBlock.ethereum = currentBlock;
        console.log(`🔵 Ethereum starting from block: ${currentBlock}`);
      }

      // CATCH-UP LOGIC: If we missed blocks during downtime, process them
      const currentBlock = await this.ethProvider.getBlockNumber();
      if (currentBlock > this.lastProcessedBlock.ethereum + 1) {
        const missedBlocks = currentBlock - this.lastProcessedBlock.ethereum - 1;
        console.log(`⚠️ Ethereum: Missed ${missedBlocks} blocks during downtime. Catching up...`);

        // Process missed blocks (limit to last 1000 blocks to avoid overwhelming)
        const startBlock = Math.max(this.lastProcessedBlock.ethereum + 1, currentBlock - 1000);
        for (let blockNum = startBlock; blockNum <= currentBlock; blockNum++) {
          await this.processEthereumBlock(blockNum, addressMap);
        }
      }

      // Listen for new blocks
      this.ethProvider.on('block', async (blockNumber) => {
        console.log(`📦 New Ethereum block: ${blockNumber}`);

        try {
          await this.processEthereumBlock(blockNumber, addressMap);
          this.lastProcessedBlock.ethereum = blockNumber;

          // Check each transaction in the block
          for (const txHash of block.transactions) {
            const tx = await this.ethProvider.getTransaction(txHash as string);

            if (!tx || !tx.to) continue;

            const toAddress = tx.to.toLowerCase();

            // Check if transaction is to one of our addresses
            if (addressMap.has(toAddress)) {
              const userId = addressMap.get(toAddress);

              // Check if native ETH transfer
              if (tx.value > 0n) {
                const deposit = {
                  user_id: userId,
                  network: 'ethereum',
                  coin_symbol: 'ETH',
                  amount: parseFloat(ethers.formatEther(tx.value)),
                  from_address: tx.from,
                  to_address: tx.to,
                  tx_hash: tx.hash,
                  confirmations: 0, // Will be updated as blocks confirm
                  block_number: blockNumber,
                  timestamp: Date.now(),
                };

                if (!this.processedTxs.has(tx.hash)) {
                  await this.notifyLaravelDeposit(deposit);
                  this.processedTxs.add(tx.hash);
                }
              }

              // Check for ERC20 token transfers
              await this.checkERC20Transfer(tx, userId, toAddress);
            }
          }
        } catch (error) {
          console.error(`❌ Error processing Ethereum block ${blockNumber}:`, error.message);
        }
      });

      console.log('✅ Ethereum WebSocket listener connected successfully');
    } catch (error) {
      console.error('❌ Failed to start Ethereum listener:', error.message);
      console.log('💡 Please check your ETH_MAINNET_RPC URL and API credentials');
      console.log('🔄 Will retry in 30 seconds...');

      setTimeout(() => {
        console.log('🔄 Retrying Ethereum listener...');
        this.startEthereumListener(addresses);
      }, 30000);
    }
  }

  private async checkERC20Transfer(tx: any, userId: number, userAddress: string) {
    try {
      const receipt = await this.ethProvider.getTransactionReceipt(tx.hash);

      if (!receipt || !receipt.logs) return;

      // ERC20 Transfer event signature: Transfer(address,address,uint256)
      const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

      for (const log of receipt.logs) {
        if (log.topics[0] === transferTopic) {
          // Decode transfer event
          const toAddress = '0x' + log.topics[2].slice(26); // Remove padding

          if (toAddress.toLowerCase() === userAddress.toLowerCase()) {
            const amount = BigInt(log.data);
            const tokenAddress = log.address;

            // Get token info (symbol, decimals)
            const tokenInfo = await this.getERC20TokenInfo(tokenAddress);

            const deposit = {
              user_id: userId,
              network: 'ethereum',
              coin_symbol: tokenInfo.symbol,
              amount: parseFloat(ethers.formatUnits(amount, tokenInfo.decimals)),
              from_address: '0x' + log.topics[1].slice(26),
              to_address: userAddress,
              tx_hash: tx.hash,
              confirmations: 0,
              block_number: receipt.blockNumber,
              timestamp: Date.now(),
              token_contract: tokenAddress,
            };

            if (!this.processedTxs.has(tx.hash + tokenAddress)) {
              await this.notifyLaravelDeposit(deposit);
              this.processedTxs.add(tx.hash + tokenAddress);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error checking ERC20 transfer:', error.message);
    }
  }

  private async getERC20TokenInfo(tokenAddress: string): Promise<{ symbol: string; decimals: number }> {
    try {
      const contract = new ethers.Contract(
        tokenAddress,
        ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'],
        this.ethProvider,
      );

      const [symbol, decimals] = await Promise.all([contract.symbol(), contract.decimals()]);

      return { symbol, decimals: Number(decimals) };
    } catch (error) {
      console.error('Error getting token info:', error.message);
      return { symbol: 'UNKNOWN', decimals: 18 };
    }
  }

  // ==================== BITCOIN LISTENER ====================

  /**
   * Monitor Bitcoin blockchain for deposits
   * Method: Polling for UTXO changes
   */
  async startBitcoinListener(addresses: Array<{ user_id: number; address: string }>) {
    console.log('🔍 Starting Bitcoin deposit listener...');
    console.log(`Monitoring ${addresses.length} Bitcoin addresses`);

    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    while (true) {
      try {
        for (const addr of addresses) {
          await this.checkBitcoinDeposits(addr.user_id, addr.address);
        }

        consecutiveErrors = 0; // Reset error counter on success
        await this.sleep(300000); // Check every 5 minutes
      } catch (error) {
        consecutiveErrors++;
        console.error(`❌ Bitcoin listener error (${consecutiveErrors}/${maxConsecutiveErrors}):`, error.message);

        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.error('💡 Please check your BTC_MAINNET_RPC URL and API credentials');
          console.log('🔄 Continuing to retry every 5 minutes...');
        }

        await this.sleep(300000);
      }
    }
  }

  private async checkBitcoinDeposits(userId: number, address: string) {
    try {
      // Use JSON-RPC to scan recent blocks for transactions to this address
      const currentHeight = await this.getBitcoinCurrentHeight();

      // Scan last 6 blocks (~1 hour) - we check every 5 minutes, so this covers recent deposits
      for (let i = 0; i < 6; i++) {
        const blockHeight = currentHeight - i;
        const blockHash = await this.getBitcoinBlockHash(blockHeight);

        // Get block with verbosity 2 to include full transaction details
        const block = await this.getBitcoinBlockWithTransactions(blockHash);

        if (!block || !block.tx) continue;

        // Check each transaction in the block
        for (const tx of block.tx) {
          const txHash = tx.txid;

          if (this.processedTxs.has(txHash)) continue;

          // Check if any output is to our address
          for (const vout of tx.vout) {
            // Bitcoin RPC returns address in scriptPubKey.address (or addresses array for multisig)
            const outputAddress = vout.scriptPubKey?.address || vout.scriptPubKey?.addresses?.[0];

            if (outputAddress === address) {
              const deposit = {
                user_id: userId,
                network: 'bitcoin',
                coin_symbol: 'BTC',
                amount: vout.value, // Already in BTC from JSON-RPC
                from_address: tx.vin?.[0]?.prevout?.scriptPubKey?.address || 'coinbase',
                to_address: address,
                tx_hash: txHash,
                confirmations: currentHeight - blockHeight + 1,
                block_number: blockHeight,
                timestamp: block.time || Date.now() / 1000,
              };

              console.log(`💰 Bitcoin deposit detected: ${deposit.amount} BTC to user ${userId}`);

              if (!this.processedTxs.has(txHash)) {
                await this.notifyLaravelDeposit(deposit);
                this.processedTxs.add(txHash);
              }
            }
          }
        }
      }
    } catch (error) {
      if (error.response?.status === 401) {
        throw new Error('Bitcoin API authentication failed - check your API key');
      } else if (error.code === 'ECONNREFUSED') {
        throw new Error('Cannot connect to Bitcoin RPC - check your network connection');
      } else if (error.code === 'ETIMEDOUT') {
        console.error(`⚠️ Bitcoin API timeout for ${address} - will retry next cycle`);
      } else {
        throw error;
      }
    }
  }

  private async getBitcoinBlockHash(height: number): Promise<string> {
    const response = await axios.post(
      this.bitcoinRpc,
      {
        jsonrpc: '1.0',
        id: 'getblockhash',
        method: 'getblockhash',
        params: [height],
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      },
    );
    return response.data.result;
  }

  private async getBitcoinBlockWithTransactions(blockHash: string): Promise<any> {
    const response = await axios.post(
      this.bitcoinRpc,
      {
        jsonrpc: '1.0',
        id: 'getblock',
        method: 'getblock',
        params: [blockHash, 2], // Verbosity 2 = full transaction details (no need for getrawtransaction)
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      },
    );
    return response.data.result;
  }

  private async getBitcoinCurrentHeight(): Promise<number> {
    const response = await axios.post(
      this.bitcoinRpc,
      {
        jsonrpc: '1.0',
        id: 'getblockcount',
        method: 'getblockcount',
        params: [],
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      },
    );
    return response.data.result;
  }

  // ==================== SOLANA LISTENER ====================

  /**
   * Monitor Solana blockchain for deposits
   * Method: WebSocket account subscriptions
   */
  async startSolanaListener(addresses: Array<{ user_id: number; address: string }>) {
    console.log('🔍 Starting Solana deposit listener...');
    console.log(`Monitoring ${addresses.length} Solana addresses`);

    try {
      // Convert WSS to HTTPS if needed - Solana Connection expects HTTP/HTTPS
      // It will automatically use WebSocket for subscriptions
      const solanaRpcUrl = this.solanaRpc.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
      this.solanaConnection = new Connection(solanaRpcUrl, 'confirmed');

      // Subscribe to each address
      for (const addr of addresses) {
        await this.subscribeSolanaAddress(addr.user_id, addr.address);
      }

      console.log('✅ Solana WebSocket listener connected successfully');
    } catch (error) {
      console.error('❌ Failed to start Solana listener:', error.message);
      console.log('💡 Please check your SOLANA_MAINNET_RPC URL and API credentials');
      console.log('🔄 Will retry in 30 seconds...');

      setTimeout(() => {
        console.log('🔄 Retrying Solana listener...');
        this.startSolanaListener(addresses);
      }, 30000);
    }
  }

  private async subscribeSolanaAddress(userId: number, address: string) {
    try {
      const publicKey = new PublicKey(address);

      // Subscribe to account changes (SOL deposits) with error handling
      this.solanaConnection.onAccountChange(
        publicKey,
        async (accountInfo, context) => {
          try {
            console.log(`💰 Solana balance change detected for user ${userId}`);

            // Get recent transactions
            const signatures = await this.solanaConnection.getSignaturesForAddress(publicKey, { limit: 10 });

            for (const sigInfo of signatures) {
              if (this.processedTxs.has(sigInfo.signature)) continue;

              const tx = await this.solanaConnection.getTransaction(sigInfo.signature, {
                maxSupportedTransactionVersion: 0,
              });

              if (!tx) continue;

              // Parse Solana transaction
              const deposit = await this.parseSolanaTransaction(tx, userId, address, sigInfo.signature);

              if (deposit) {
                await this.notifyLaravelDeposit(deposit);
                this.processedTxs.add(sigInfo.signature);
              }
            }
          } catch (error) {
            console.error(`❌ Error processing Solana account change for user ${userId}:`, error.message);
          }
        },
        'confirmed',
      );

      console.log(`✅ Subscribed to Solana address: ${address}`);
    } catch (error) {
      console.error(`❌ Error subscribing to Solana address ${address}:`, error.message);
      throw error;
    }
  }

  private async parseSolanaTransaction(tx: any, userId: number, address: string, signature: string) {
    try {
      const publicKey = new PublicKey(address);

      // Get pre and post balances
      const accountIndex = tx.transaction.message.accountKeys.findIndex((key: any) =>
        key.equals ? key.equals(publicKey) : key.toBase58() === address,
      );

      if (accountIndex === -1) return null;

      const preBalance = tx.meta.preBalances[accountIndex];
      const postBalance = tx.meta.postBalances[accountIndex];
      const difference = postBalance - preBalance;

      if (difference <= 0) return null; // Not an incoming transfer

      // Get confirmations
      const currentSlot = await this.solanaConnection.getSlot();
      const confirmations = currentSlot - tx.slot;

      return {
        user_id: userId,
        network: 'solana',
        coin_symbol: 'SOL',
        amount: difference / 1e9, // Convert lamports to SOL
        from_address: 'unknown', // Can be extracted from instruction
        to_address: address,
        tx_hash: signature,
        confirmations: confirmations,
        block_number: tx.slot,
        timestamp: tx.blockTime || Date.now() / 1000,
      };
    } catch (error) {
      console.error('Error parsing Solana transaction:', error.message);
      return null;
    }
  }

  // ==================== WEBHOOK NOTIFICATION ====================

  /**
   * Send deposit notification to Laravel via webhook
   */
  private async notifyLaravelDeposit(depositData: any) {
    try {
      // Create HMAC signature for authentication
      const signature = crypto
        .createHmac('sha256', this.laravelApiSecret)
        .update(JSON.stringify(depositData))
        .digest('hex');

      // Send webhook to Laravel
      const response = await axios.post(this.laravelWebhookUrl, depositData, {
        headers: {
          'X-Signature': signature,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });

      console.log(
        `✅ Notified Laravel: ${depositData.amount} ${depositData.coin_symbol} to user ${depositData.user_id} (tx: ${depositData.tx_hash.substring(0, 10)}...)`,
      );

      return response.data;
    } catch (error) {
      console.error('Failed to notify Laravel:', error.message);

      // TODO: Implement retry queue
      // Store failed webhooks in database for retry

      throw error;
    }
  }

  // ==================== HELPER METHODS ====================

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Start all listeners
   */
  async startAllListeners(addressesByNetwork: {
    tron: Array<{ user_id: number; address: string }>;
    ethereum: Array<{ user_id: number; address: string }>;
    bitcoin: Array<{ user_id: number; address: string }>;
    solana: Array<{ user_id: number; address: string }>;
  }) {
    console.log('🚀 Starting all blockchain listeners...');

    // Start all listeners in parallel
    await Promise.all([
      this.startTronListener(addressesByNetwork.tron),
      this.startEthereumListener(addressesByNetwork.ethereum),
      this.startBitcoinListener(addressesByNetwork.bitcoin),
      this.startSolanaListener(addressesByNetwork.solana),
    ]);
  }
}

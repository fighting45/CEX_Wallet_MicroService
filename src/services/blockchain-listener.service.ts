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
  private ethereumRpc: string;
  private bitcoinRpc: string;
  private solanaRpc: string;

  // Providers
  private ethProvider: ethers.WebSocketProvider;
  private solanaConnection: Connection;

  // Tracking processed transactions (to avoid duplicates)
  private processedTxs: Set<string> = new Set();

  constructor(private configService: ConfigService) {
    this.laravelWebhookUrl = this.configService.get('LARAVEL_URL') + '/api/webhooks/deposit';
    this.laravelApiSecret = this.configService.get('LARAVEL_API_SECRET');

    // RPC URLs
    this.tronRpc = this.configService.get('TRON_MAINNET_RPC', 'https://api.trongrid.io');
    this.ethereumRpc = this.configService.get('ETH_MAINNET_RPC', 'wss://eth-mainnet.g.alchemy.com/v2/your-api-key');
    this.bitcoinRpc = this.configService.get('BTC_MAINNET_RPC', 'https://blockstream.info/api');
    this.solanaRpc = this.configService.get('SOLANA_MAINNET_RPC', 'https://api.mainnet-beta.solana.com');
  }

  // ==================== TRON LISTENER ====================

  /**
   * Monitor Tron blockchain for deposits
   * Method: HTTP polling every 30 seconds
   */
  async startTronListener(addresses: Array<{ user_id: number; address: string }>) {
    console.log('🔍 Starting Tron deposit listener...');
    console.log(`Monitoring ${addresses.length} Tron addresses`);

    while (true) {
      try {
        for (const addr of addresses) {
          await this.checkTronDeposits(addr.user_id, addr.address);
        }

        await this.sleep(30000); // Check every 30 seconds
      } catch (error) {
        console.error('Tron listener error:', error.message);
        await this.sleep(60000); // Wait longer on error
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
            order_by: 'block_timestamp,desc',
          },
        },
      );

      const transactions = response.data.data || [];

      for (const tx of transactions) {
        const txHash = tx.txID;

        // Skip if already processed
        if (this.processedTxs.has(txHash)) continue;

        // Check if incoming transaction
        if (this.isTronIncoming(tx, address)) {
          const deposit = await this.parseTronTransaction(tx, userId, address);
          await this.notifyLaravelDeposit(deposit);
          this.processedTxs.add(txHash);
        }
      }
    } catch (error) {
      console.error(`Error checking Tron deposits for ${address}:`, error.message);
    }
  }

  private isTronIncoming(tx: any, address: string): boolean {
    // Check TRX transfers
    if (tx.raw_data?.contract?.[0]?.parameter?.value?.to_address) {
      const toAddress = this.tronHexToBase58(tx.raw_data.contract[0].parameter.value.to_address);
      return toAddress === address;
    }

    // Check TRC20 token transfers (in contract result)
    if (tx.raw_data?.contract?.[0]?.type === 'TriggerSmartContract') {
      // Parse TRC20 transfer event
      // TODO: Implement TRC20 event parsing
    }

    return false;
  }

  private async parseTronTransaction(tx: any, userId: number, address: string) {
    const contract = tx.raw_data.contract[0];
    const value = contract.parameter.value;

    // Get confirmations
    const currentBlock = await this.getTronCurrentBlock();
    const confirmations = currentBlock - tx.blockNumber;

    return {
      user_id: userId,
      network: 'tron',
      coin_symbol: 'TRX', // TODO: Detect TRC20 tokens
      amount: value.amount / 1e6, // Convert SUN to TRX
      from_address: this.tronHexToBase58(value.owner_address),
      to_address: address,
      tx_hash: tx.txID,
      confirmations: confirmations,
      block_number: tx.blockNumber,
      timestamp: tx.block_timestamp,
    };
  }

  private async getTronCurrentBlock(): Promise<number> {
    const response = await axios.get(`${this.tronRpc}/wallet/getnowblock`);
    return response.data.block_header.raw_data.number;
  }

  private tronHexToBase58(hexAddress: string): string {
    // Convert hex address to base58
    // Simplified - use actual tronweb for production
    return hexAddress; // TODO: Implement proper conversion
  }

  // ==================== ETHEREUM LISTENER ====================

  /**
   * Monitor Ethereum blockchain for deposits
   * Method: WebSocket subscriptions for real-time detection
   */
  async startEthereumListener(addresses: Array<{ user_id: number; address: string }>) {
    console.log('🔍 Starting Ethereum deposit listener...');
    console.log(`Monitoring ${addresses.length} Ethereum addresses`);

    // Create WebSocket provider
    this.ethProvider = new ethers.WebSocketProvider(this.ethereumRpc);

    // Create address to user_id mapping
    const addressMap = new Map(addresses.map((a) => [a.address.toLowerCase(), a.user_id]));

    // Listen for new blocks
    this.ethProvider.on('block', async (blockNumber) => {
      console.log(`📦 New Ethereum block: ${blockNumber}`);

      try {
        const block = await this.ethProvider.getBlock(blockNumber, true);

        if (!block || !block.transactions) return;

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
        console.error(`Error processing Ethereum block ${blockNumber}:`, error.message);
      }
    });

    // Handle reconnection
    this.ethProvider.on('error', (error) => {
      console.error('Ethereum WebSocket error:', error);
      // Reconnect logic
      setTimeout(() => this.startEthereumListener(addresses), 5000);
    });
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

    while (true) {
      try {
        for (const addr of addresses) {
          await this.checkBitcoinDeposits(addr.user_id, addr.address);
        }

        await this.sleep(60000); // Check every 60 seconds (Bitcoin is slower)
      } catch (error) {
        console.error('Bitcoin listener error:', error.message);
        await this.sleep(120000);
      }
    }
  }

  private async checkBitcoinDeposits(userId: number, address: string) {
    try {
      // Get address transactions from Blockstream API
      const response = await axios.get(`${this.bitcoinRpc}/address/${address}/txs`);

      const transactions = response.data;

      for (const tx of transactions) {
        const txHash = tx.txid;

        if (this.processedTxs.has(txHash)) continue;

        // Check if this transaction has outputs to our address
        for (const vout of tx.vout) {
          if (vout.scriptpubkey_address === address) {
            // Get confirmations
            const currentHeight = await this.getBitcoinCurrentHeight();
            const confirmations = tx.status.confirmed ? currentHeight - tx.status.block_height + 1 : 0;

            const deposit = {
              user_id: userId,
              network: 'bitcoin',
              coin_symbol: 'BTC',
              amount: vout.value / 1e8, // Convert satoshis to BTC
              from_address: tx.vin[0]?.prevout?.scriptpubkey_address || 'unknown',
              to_address: address,
              tx_hash: txHash,
              confirmations: confirmations,
              block_number: tx.status.block_height || 0,
              timestamp: tx.status.block_time || Date.now() / 1000,
            };

            if (!this.processedTxs.has(txHash)) {
              await this.notifyLaravelDeposit(deposit);
              this.processedTxs.add(txHash);
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error checking Bitcoin deposits for ${address}:`, error.message);
    }
  }

  private async getBitcoinCurrentHeight(): Promise<number> {
    const response = await axios.get(`${this.bitcoinRpc}/blocks/tip/height`);
    return response.data;
  }

  // ==================== SOLANA LISTENER ====================

  /**
   * Monitor Solana blockchain for deposits
   * Method: WebSocket account subscriptions
   */
  async startSolanaListener(addresses: Array<{ user_id: number; address: string }>) {
    console.log('🔍 Starting Solana deposit listener...');
    console.log(`Monitoring ${addresses.length} Solana addresses`);

    this.solanaConnection = new Connection(this.solanaRpc, 'confirmed');

    // Subscribe to each address
    for (const addr of addresses) {
      await this.subscribeSolanaAddress(addr.user_id, addr.address);
    }
  }

  private async subscribeSolanaAddress(userId: number, address: string) {
    try {
      const publicKey = new PublicKey(address);

      // Subscribe to account changes (SOL deposits)
      this.solanaConnection.onAccountChange(
        publicKey,
        async (accountInfo, context) => {
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
        },
        'confirmed',
      );

      console.log(`✅ Subscribed to Solana address: ${address}`);
    } catch (error) {
      console.error(`Error subscribing to Solana address ${address}:`, error.message);
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

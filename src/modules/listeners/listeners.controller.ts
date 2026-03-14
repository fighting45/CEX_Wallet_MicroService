import { Controller, Post, Body, Get } from '@nestjs/common';
import { BlockchainListenerService } from '../../services/blockchain-listener.service';

/**
 * ListenersController - Manage blockchain deposit listeners
 *
 * These endpoints allow you to start/test the blockchain listeners
 */
@Controller('listeners')
export class ListenersController {
  private listenersRunning = {
    tron: false,
    ethereum: false,
    bitcoin: false,
    solana: false,
  };

  constructor(private readonly blockchainListener: BlockchainListenerService) {}

  /**
   * Get status of all listeners
   * GET /api/listeners/status
   */
  @Get('status')
  getStatus() {
    return {
      listeners: this.listenersRunning,
      message: 'Use POST /api/listeners/start to start monitoring addresses',
    };
  }

  /**
   * Start blockchain listeners for specific addresses
   * POST /api/listeners/start
   *
   * Request body:
   * {
   *   "addresses": [
   *     { "network": "tron", "user_id": 1, "address": "TYour..." },
   *     { "network": "ethereum", "user_id": 2, "address": "0xYour..." }
   *   ]
   * }
   */
  @Post('start')
  async startListeners(
    @Body('addresses')
    addresses: Array<{ network: string; user_id: number; address: string }>,
  ) {
    if (!addresses || addresses.length === 0) {
      return {
        error: 'No addresses provided',
        example: {
          addresses: [
            { network: 'tron', user_id: 1, address: 'TYourAddress...' },
            { network: 'ethereum', user_id: 2, address: '0xYourAddress...' },
            { network: 'bitcoin', user_id: 3, address: 'bc1qYourAddress...' },
            { network: 'solana', user_id: 4, address: 'YourSolanaAddress...' },
          ],
        },
      };
    }

    // Group addresses by network
    const tronAddresses = addresses.filter((a) => a.network === 'tron');
    const ethereumAddresses = addresses.filter((a) => a.network === 'ethereum');
    const bitcoinAddresses = addresses.filter((a) => a.network === 'bitcoin');
    const solanaAddresses = addresses.filter((a) => a.network === 'solana');

    // Start listeners for each network (non-blocking)
    const started = [];

    if (tronAddresses.length > 0 && !this.listenersRunning.tron) {
      this.blockchainListener.startTronListener(tronAddresses);
      this.listenersRunning.tron = true;
      started.push(`Tron (${tronAddresses.length} addresses, polling every 5 min)`);
    }

    if (ethereumAddresses.length > 0 && !this.listenersRunning.ethereum) {
      this.blockchainListener.startEthereumListener(ethereumAddresses);
      this.listenersRunning.ethereum = true;
      started.push(`Ethereum (${ethereumAddresses.length} addresses, WebSocket real-time)`);
    }

    if (bitcoinAddresses.length > 0 && !this.listenersRunning.bitcoin) {
      this.blockchainListener.startBitcoinListener(bitcoinAddresses);
      this.listenersRunning.bitcoin = true;
      started.push(`Bitcoin (${bitcoinAddresses.length} addresses, polling every 5 min)`);
    }

    if (solanaAddresses.length > 0 && !this.listenersRunning.solana) {
      this.blockchainListener.startSolanaListener(solanaAddresses);
      this.listenersRunning.solana = true;
      started.push(`Solana (${solanaAddresses.length} addresses, WebSocket real-time)`);
    }

    if (started.length === 0) {
      return {
        message: 'All requested listeners are already running',
        status: this.listenersRunning,
      };
    }

    return {
      success: true,
      started: started,
      message: 'Blockchain listeners started successfully',
      monitoring: {
        tron: tronAddresses.length,
        ethereum: ethereumAddresses.length,
        bitcoin: bitcoinAddresses.length,
        solana: solanaAddresses.length,
      },
      note: 'Listeners are now running in the background. Check server logs for deposit events.',
    };
  }

  /**
   * Test webhook to your backend (without actual blockchain monitoring)
   * POST /api/listeners/test-webhook
   *
   * This sends a fake deposit notification to test your backend webhook handler
   */
  @Post('test-webhook')
  async testWebhook(@Body('network') network?: string) {
    const testDeposit = {
      user_id: 999,
      network: network || 'tron',
      coin_symbol: network === 'ethereum' ? 'ETH' : network === 'bitcoin' ? 'BTC' : 'TRX',
      amount: 100.5,
      from_address: 'TSender123TestAddress',
      to_address: 'TReceiver456TestAddress',
      tx_hash: '0xtest1234567890abcdef',
      confirmations: 0,
      block_number: 12345678,
      timestamp: Date.now(),
    };

    try {
      await this.blockchainListener['notifyLaravelDeposit'](testDeposit);
      return {
        success: true,
        message: 'Test webhook sent to your backend',
        sent_data: testDeposit,
        note: 'Check your backend logs to see if webhook was received',
      };
    } catch (error) {
      return {
        error: 'Failed to send webhook',
        message: error.message,
        hint: 'Check LARAVEL_URL and LARAVEL_API_SECRET in .env',
      };
    }
  }
}

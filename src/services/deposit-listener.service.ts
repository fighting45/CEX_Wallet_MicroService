import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/**
 * DepositListenerService
 *
 * Monitors blockchain for deposits to user addresses
 * Sends webhook to Laravel when deposits are detected
 *
 * NOTE: This is OPTIONAL. Laravel can also run its own listeners.
 */
@Injectable()
export class DepositListenerService {
  private laravelWebhookUrl: string;
  private laravelApiSecret: string;

  constructor(private configService: ConfigService) {
    this.laravelWebhookUrl = this.configService.get('LARAVEL_URL') + '/api/webhooks/deposit';
    this.laravelApiSecret = this.configService.get('LARAVEL_API_SECRET');
  }

  /**
   * Start monitoring Tron blockchain for deposits
   */
  async startTronListener(addresses: Array<{user_id: number, address: string}>) {
    console.log('🔍 Starting Tron deposit listener...');

    while (true) {
      try {
        for (const addr of addresses) {
          await this.checkTronDeposits(addr.user_id, addr.address);
        }

        await this.sleep(30000); // Check every 30 seconds
      } catch (error) {
        console.error('Tron listener error:', error);
        await this.sleep(60000); // Wait longer on error
      }
    }
  }

  /**
   * Check for deposits to a specific address
   */
  private async checkTronDeposits(userId: number, address: string) {
    // 1. Query TronGrid API for transactions
    const response = await axios.get(
      `https://api.trongrid.io/v1/accounts/${address}/transactions`,
      {
        params: {
          limit: 20,
          order_by: 'block_timestamp,desc'
        }
      }
    );

    const transactions = response.data.data || [];

    for (const tx of transactions) {
      // 2. Check if transaction is incoming (to this address)
      if (tx.to_address === address) {
        // 3. Send webhook to Laravel
        await this.notifyLaravelDeposit({
          user_id: userId,
          network: 'tron',
          coin_symbol: tx.token_name || 'TRX',
          amount: tx.value / 1e6, // Convert from SUN to TRX
          from_address: tx.from_address,
          to_address: address,
          tx_hash: tx.transaction_id,
          confirmations: tx.confirmations || 0,
          block_number: tx.block_number,
          timestamp: tx.block_timestamp,
        });
      }
    }
  }

  /**
   * Send deposit notification to Laravel via webhook
   */
  private async notifyLaravelDeposit(depositData: any) {
    try {
      // Create HMAC signature for authentication
      const crypto = require('crypto');
      const signature = crypto
        .createHmac('sha256', this.laravelApiSecret)
        .update(JSON.stringify(depositData))
        .digest('hex');

      // Send webhook to Laravel
      const response = await axios.post(
        this.laravelWebhookUrl,
        depositData,
        {
          headers: {
            'X-Signature': signature,
            'Content-Type': 'application/json',
          }
        }
      );

      console.log(`✅ Notified Laravel of deposit: ${depositData.amount} ${depositData.coin_symbol} to user ${depositData.user_id}`);
      return response.data;

    } catch (error) {
      console.error('Failed to notify Laravel:', error.message);
      // TODO: Implement retry logic with exponential backoff
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

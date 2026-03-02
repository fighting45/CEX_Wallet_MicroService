import { Module } from '@nestjs/common';
import { TronWalletService } from './tron-wallet.service';

/**
 * TronWalletModule
 *
 * Provides Tron wallet functionality to the application
 */
@Module({
  providers: [TronWalletService],
  exports: [TronWalletService], // Make available to other modules
})
export class TronWalletModule {}

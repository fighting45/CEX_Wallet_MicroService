import { Module } from '@nestjs/common';
import { BitcoinWalletService } from './bitcoin-wallet.service';

/**
 * BitcoinWalletModule
 *
 * Provides Bitcoin wallet functionality
 */
@Module({
  providers: [BitcoinWalletService],
  exports: [BitcoinWalletService], // Make available to other modules
})
export class BitcoinWalletModule {}

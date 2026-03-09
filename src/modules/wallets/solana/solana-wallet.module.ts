import { Module } from '@nestjs/common';
import { SolanaWalletService } from './solana-wallet.service';

/**
 * SolanaWalletModule
 *
 * Provides Solana (and SPL tokens) wallet functionality
 */
@Module({
  providers: [SolanaWalletService],
  exports: [SolanaWalletService], // Make available to other modules
})
export class SolanaWalletModule {}

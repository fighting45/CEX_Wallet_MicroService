import { Module } from '@nestjs/common';
import { WalletsController } from './wallets.controller';
import { TronWalletModule } from './tron/tron-wallet.module';
import { EncryptionModule } from '../encryption/encryption.module';

/**
 * WalletsModule - Main wallet module
 *
 * Aggregates all blockchain wallet modules (Tron, Ethereum, Bitcoin, Solana)
 */
@Module({
  imports: [
    TronWalletModule, // Import Tron wallet functionality
    EncryptionModule, // Import encryption for seed storage
  ],
  controllers: [WalletsController],
})
export class WalletsModule {}

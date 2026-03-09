import { Module } from '@nestjs/common';
import { WalletsController } from './wallets.controller';
import { TronWalletModule } from './tron/tron-wallet.module';
import { EthereumWalletModule } from './ethereum/ethereum-wallet.module';
import { BitcoinWalletModule } from './bitcoin/bitcoin-wallet.module';
import { SolanaWalletModule } from './solana/solana-wallet.module';
import { EncryptionModule } from '../encryption/encryption.module';

/**
 * WalletsModule - Main wallet module
 *
 * Aggregates all blockchain wallet modules (Tron, Ethereum, Bitcoin, Solana)
 */
@Module({
  imports: [
    TronWalletModule, // Tron wallet functionality
    EthereumWalletModule, // Ethereum & EVM chains wallet functionality
    BitcoinWalletModule, // Bitcoin wallet functionality
    SolanaWalletModule, // Solana wallet functionality
    EncryptionModule, // Encryption for seed storage
  ],
  controllers: [WalletsController],
})
export class WalletsModule {}

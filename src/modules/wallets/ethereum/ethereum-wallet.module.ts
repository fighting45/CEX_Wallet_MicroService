import { Module } from '@nestjs/common';
import { EthereumWalletService } from './ethereum-wallet.service';

/**
 * EthereumWalletModule
 *
 * Provides Ethereum (and EVM-compatible chains) wallet functionality
 */
@Module({
  providers: [EthereumWalletService],
  exports: [EthereumWalletService], // Make available to other modules
})
export class EthereumWalletModule {}

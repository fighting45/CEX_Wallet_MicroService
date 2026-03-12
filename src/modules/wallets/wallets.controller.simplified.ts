import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { TronWalletService } from './tron/tron-wallet.service';
import { EthereumWalletService } from './ethereum/ethereum-wallet.service';
import { BitcoinWalletService } from './bitcoin/bitcoin-wallet.service';
import { SolanaWalletService } from './solana/solana-wallet.service';

/**
 * WalletsController - Stateless Wallet Microservice API
 *
 * This service performs cryptographic operations only.
 * Laravel backend handles all database operations.
 *
 * Main Endpoints:
 * - /generate - Generate new mnemonic (used once per network)
 * - /derive - Derive address from mnemonic + index (main endpoint Laravel calls)
 * - /validate - Validate address format
 */
@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly tronWalletService: TronWalletService,
    private readonly ethereumWalletService: EthereumWalletService,
    private readonly bitcoinWalletService: BitcoinWalletService,
    private readonly solanaWalletService: SolanaWalletService,
  ) {}

  // ==================== TRON ENDPOINTS ====================

  /**
   * Generate new Tron master mnemonic
   * GET /api/wallets/tron/generate
   *
   * Laravel calls this ONCE per network to create master seed
   * Then stores the mnemonic encrypted in its database
   */
  @Get('tron/generate')
  generateTronMnemonic() {
    const mnemonic = this.tronWalletService.generateMnemonic(12);
    return {
      network: 'tron',
      mnemonic: mnemonic,
      derivationPathTemplate: "m/44'/195'/0'/0/{index}",
      note: 'Store this mnemonic encrypted in your database. Never expose it.',
    };
  }

  /**
   * Derive Tron address from mnemonic
   * GET /api/wallets/tron/derive?mnemonic=xxx&index=123
   *
   * Laravel calls this to generate address for each user
   */
  @Get('tron/derive')
  deriveTronAddress(
    @Query('mnemonic') mnemonic: string,
    @Query('index') index?: string,
  ) {
    if (!mnemonic) {
      return {
        error: 'Mnemonic is required',
        example: '/api/wallets/tron/derive?mnemonic=your twelve word phrase&index=0',
      };
    }

    if (!this.tronWalletService.validateMnemonic(mnemonic)) {
      return { error: 'Invalid mnemonic phrase' };
    }

    const addressIndex = index ? parseInt(index, 10) : 0;
    const address = this.tronWalletService.deriveAddress(mnemonic, addressIndex);

    return {
      network: 'tron',
      address: address.address,
      derivationPath: address.derivationPath,
      index: address.index,
      hexAddress: this.tronWalletService.toHexAddress(address.address),
    };
  }

  /**
   * Validate Tron address
   * GET /api/wallets/tron/validate?address=TXxx...
   */
  @Get('tron/validate')
  validateTronAddress(@Query('address') address: string) {
    if (!address) {
      return { error: 'Address is required' };
    }

    return {
      address,
      isValid: this.tronWalletService.isValidAddress(address),
      hexAddress: this.tronWalletService.isValidAddress(address)
        ? this.tronWalletService.toHexAddress(address)
        : null,
    };
  }

  // ==================== ETHEREUM ENDPOINTS ====================

  @Get('ethereum/generate')
  generateEthereumMnemonic() {
    const mnemonic = this.ethereumWalletService.generateMnemonic(12);
    return {
      network: 'ethereum',
      mnemonic: mnemonic,
      derivationPathTemplate: "m/44'/60'/0'/0/{index}",
      supportedChains: ['Ethereum', 'BSC', 'Polygon', 'Arbitrum', 'Avalanche', 'Optimism'],
      note: 'Store this mnemonic encrypted in your database. Never expose it.',
    };
  }

  @Get('ethereum/derive')
  deriveEthereumAddress(
    @Query('mnemonic') mnemonic: string,
    @Query('index') index?: string,
  ) {
    if (!mnemonic) {
      return { error: 'Mnemonic is required' };
    }

    if (!this.ethereumWalletService.validateMnemonic(mnemonic)) {
      return { error: 'Invalid mnemonic phrase' };
    }

    const addressIndex = index ? parseInt(index, 10) : 0;
    const address = this.ethereumWalletService.deriveAddress(mnemonic, addressIndex);

    return {
      network: 'ethereum',
      address: address.address,
      derivationPath: address.derivationPath,
      index: address.index,
      checksumAddress: this.ethereumWalletService.getChecksumAddress(address.address),
    };
  }

  @Get('ethereum/validate')
  validateEthereumAddress(@Query('address') address: string) {
    if (!address) {
      return { error: 'Address is required' };
    }

    return {
      address,
      isValid: this.ethereumWalletService.isValidAddress(address),
      checksumAddress: this.ethereumWalletService.isValidAddress(address)
        ? this.ethereumWalletService.getChecksumAddress(address)
        : null,
    };
  }

  // ==================== BITCOIN ENDPOINTS ====================

  @Get('bitcoin/generate')
  generateBitcoinMnemonic() {
    const mnemonic = this.bitcoinWalletService.generateMnemonic(12);
    return {
      network: 'bitcoin',
      mnemonic: mnemonic,
      derivationPaths: {
        'native-segwit': "m/84'/0'/0'/0/{index}",
        'legacy': "m/44'/0'/0'/0/{index}",
      },
      note: 'Store this mnemonic encrypted in your database. Never expose it.',
    };
  }

  @Get('bitcoin/derive')
  deriveBitcoinAddress(
    @Query('mnemonic') mnemonic: string,
    @Query('index') index?: string,
    @Query('type') type?: string,
  ) {
    if (!mnemonic) {
      return { error: 'Mnemonic is required' };
    }

    if (!this.bitcoinWalletService.validateMnemonic(mnemonic)) {
      return { error: 'Invalid mnemonic phrase' };
    }

    const addressIndex = index ? parseInt(index, 10) : 0;
    const addressType = (type === 'legacy' ? 'legacy' : 'native-segwit') as 'legacy' | 'native-segwit';
    const address = this.bitcoinWalletService.deriveAddress(mnemonic, addressIndex, addressType);

    return {
      network: 'bitcoin',
      address: address.address,
      addressFormat: address.addressFormat,
      derivationPath: address.derivationPath,
      index: address.index,
      publicKey: address.publicKey,
    };
  }

  @Get('bitcoin/validate')
  validateBitcoinAddress(@Query('address') address: string) {
    if (!address) {
      return { error: 'Address is required' };
    }

    return {
      address,
      isValid: this.bitcoinWalletService.isValidAddress(address),
      addressType: this.bitcoinWalletService.isValidAddress(address)
        ? this.bitcoinWalletService.getAddressType(address)
        : null,
    };
  }

  // ==================== SOLANA ENDPOINTS ====================

  @Get('solana/generate')
  generateSolanaMnemonic() {
    const mnemonic = this.solanaWalletService.generateMnemonic(12);
    return {
      network: 'solana',
      mnemonic: mnemonic,
      derivationPathTemplate: "m/44'/501'/{index}'/0'",
      supportedTokens: ['SOL', 'USDC', 'USDT', 'All SPL tokens'],
      note: 'Store this mnemonic encrypted in your database. Never expose it.',
    };
  }

  @Get('solana/derive')
  deriveSolanaAddress(
    @Query('mnemonic') mnemonic: string,
    @Query('index') index?: string,
  ) {
    if (!mnemonic) {
      return { error: 'Mnemonic is required' };
    }

    if (!this.solanaWalletService.validateMnemonic(mnemonic)) {
      return { error: 'Invalid mnemonic phrase' };
    }

    const addressIndex = index ? parseInt(index, 10) : 0;
    const address = this.solanaWalletService.deriveAddress(mnemonic, addressIndex);

    return {
      network: 'solana',
      address: address.address,
      publicKey: address.publicKey,
      derivationPath: address.derivationPath,
      index: address.index,
    };
  }

  @Get('solana/validate')
  validateSolanaAddress(@Query('address') address: string) {
    if (!address) {
      return { error: 'Address is required' };
    }

    return {
      address,
      isValid: this.solanaWalletService.isValidAddress(address),
    };
  }
}

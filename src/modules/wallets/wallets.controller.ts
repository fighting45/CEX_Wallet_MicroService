import { Controller, Get, Query } from '@nestjs/common';
import { TronWalletService } from './tron/tron-wallet.service';
import { EncryptionService } from '../encryption/encryption.service';

/**
 * WalletsController - Test endpoints for wallet generation
 *
 * These are temporary endpoints to test wallet functionality
 * In production, these will be secured and integrated with user management
 */
@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly tronWalletService: TronWalletService,
    private readonly encryptionService: EncryptionService,
  ) {}

  /**
   * Test endpoint: Generate a new Tron wallet
   * GET /api/wallets/tron/generate
   *
   * Query params:
   * - count: number of addresses to generate (default: 1)
   */
  @Get('tron/generate')
  generateTronWallet(@Query('count') count?: string) {
    const addressCount = count ? parseInt(count, 10) : 1;

    // Step 1: Generate new mnemonic
    const mnemonic = this.tronWalletService.generateMnemonic(12);

    // Step 2: Encrypt the mnemonic for safe storage
    const masterPassword = process.env.MASTER_ENCRYPTION_KEY || 'test-password-only-for-dev';
    const encryptedMnemonic = this.encryptionService.encrypt(mnemonic, masterPassword);

    // Step 3: Derive addresses
    const addresses = this.tronWalletService.deriveMultipleAddresses(
      mnemonic,
      0,
      addressCount,
    );

    // Step 4: Test decryption
    const decryptedMnemonic = this.encryptionService.decrypt(
      encryptedMnemonic,
      masterPassword,
    );

    return {
      message: 'Tron wallet generated successfully',
      mnemonic: {
        original: mnemonic,
        encrypted: encryptedMnemonic,
        decrypted: decryptedMnemonic,
        encryptionWorks: mnemonic === decryptedMnemonic,
      },
      addresses: addresses.map((addr) => ({
        address: addr.address,
        derivationPath: addr.derivationPath,
        index: addr.index,
        // WARNING: In production, NEVER expose private keys in API responses!
        // This is only for testing
        privateKey: addr.privateKey,
      })),
      note: 'SECURITY WARNING: Private keys shown for testing only. Never expose in production!',
    };
  }

  /**
   * Test endpoint: Derive address from existing mnemonic
   * GET /api/wallets/tron/derive
   *
   * Query params:
   * - mnemonic: the seed phrase
   * - index: derivation index (default: 0)
   */
  @Get('tron/derive')
  deriveTronAddress(
    @Query('mnemonic') mnemonic: string,
    @Query('index') index?: string,
  ) {
    if (!mnemonic) {
      return {
        error: 'Mnemonic is required',
        example: '/api/wallets/tron/derive?mnemonic=your twelve word phrase here&index=0',
      };
    }

    // Validate mnemonic
    if (!this.tronWalletService.validateMnemonic(mnemonic)) {
      return {
        error: 'Invalid mnemonic phrase',
      };
    }

    const addressIndex = index ? parseInt(index, 10) : 0;
    const address = this.tronWalletService.deriveAddress(mnemonic, addressIndex);

    return {
      address: address.address,
      derivationPath: address.derivationPath,
      index: address.index,
      isValidAddress: this.tronWalletService.isValidAddress(address.address),
      hexAddress: this.tronWalletService.toHexAddress(address.address),
    };
  }

  /**
   * Test endpoint: Validate a Tron address
   * GET /api/wallets/tron/validate?address=TXxx...
   */
  @Get('tron/validate')
  validateTronAddress(@Query('address') address: string) {
    if (!address) {
      return {
        error: 'Address is required',
        example: '/api/wallets/tron/validate?address=TYour...Address',
      };
    }

    return {
      address,
      isValid: this.tronWalletService.isValidAddress(address),
      hexAddress: this.tronWalletService.isValidAddress(address)
        ? this.tronWalletService.toHexAddress(address)
        : null,
    };
  }
}

import { Controller, Get, Post, Query, Param, Body } from '@nestjs/common';
import { TronWalletService } from './tron/tron-wallet.service';
import { EthereumWalletService } from './ethereum/ethereum-wallet.service';
import { BitcoinWalletService } from './bitcoin/bitcoin-wallet.service';
import { SolanaWalletService } from './solana/solana-wallet.service';
import { EncryptionService, EncryptedData } from '../encryption/encryption.service';

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
    private readonly ethereumWalletService: EthereumWalletService,
    private readonly bitcoinWalletService: BitcoinWalletService,
    private readonly solanaWalletService: SolanaWalletService,
    private readonly encryptionService: EncryptionService,
  ) {}

  // ==================== PRODUCTION ENDPOINTS ====================

  /**
   * Generate master mnemonic for initial setup (ONE-TIME USE)
   * GET /api/wallets/:network/generate-mnemonic
   *
   * Call this ONCE per network during initial setup, then save encrypted mnemonic in your database
   *
   * Supported networks: tron, ethereum, bitcoin, solana
   */
  @Get(':network/generate-mnemonic')
  generateMasterMnemonic(@Param('network') network: string) {
    // Select wallet service based on network
    let service;
    switch (network.toLowerCase()) {
      case 'tron':
        service = this.tronWalletService;
        break;
      case 'ethereum':
        service = this.ethereumWalletService;
        break;
      case 'bitcoin':
        service = this.bitcoinWalletService;
        break;
      case 'solana':
        service = this.solanaWalletService;
        break;
      default:
        return {
          error: 'Invalid network',
          supportedNetworks: ['tron', 'ethereum', 'bitcoin', 'solana'],
          example: '/api/wallets/tron/generate-mnemonic',
        };
    }

    // Generate 12-word mnemonic
    const mnemonic = service.generateMnemonic(12);

    // Encrypt with master password
    const masterPassword = process.env.MASTER_ENCRYPTION_KEY || 'test-password-only-for-dev';
    const encryptedMnemonic = this.encryptionService.encrypt(mnemonic, masterPassword);

    return {
      success: true,
      network: network.toLowerCase(),
      mnemonic: mnemonic, // Plain text - only shown during setup
      encrypted: encryptedMnemonic, // Store this in your database
      instructions: [
        '1. Save the ENCRYPTED mnemonic in your database (master_seeds table)',
        '2. NEVER expose the plain mnemonic again after this setup',
        '3. Set next_index = 1 in database (index 0 = hot wallet)',
        '4. Use /api/wallets/get-address endpoint to derive user addresses',
      ],
      security_warning:
        '⚠️  This endpoint is for ONE-TIME initial setup only. Disable in production after setup!',
    };
  }

  /**
   * Get new address for user (PRODUCTION ENDPOINT)
   * POST /api/wallets/get-address
   *
   * This is the main endpoint your backend will call when a user requests a deposit address
   *
   * Request body:
   * {
   *   "network": "tron",
   *   "encrypted_mnemonic": {
   *     "encrypted": "abc123...",
   *     "iv": "def456...",
   *     "salt": "ghi789...",
   *     "authTag": "jkl012..."
   *   },
   *   "index": 123
   * }
   */
  @Post('get-address')
  async getAddressForUser(
    @Body('network') network: string,
    @Body('encrypted_mnemonic') encryptedMnemonic: EncryptedData,
    @Body('index') index: number,
  ) {
    // Validate inputs
    if (!network || !encryptedMnemonic || index === undefined) {
      return {
        error: 'Missing required fields',
        required: {
          network: 'tron | ethereum | bitcoin | solana',
          encrypted_mnemonic: {
            encrypted: 'hex string',
            iv: 'hex string',
            salt: 'hex string',
            authTag: 'hex string',
          },
          index: 'Derivation index (integer)',
        },
        example: {
          network: 'tron',
          encrypted_mnemonic: {
            encrypted: 'abc123...',
            iv: 'def456...',
            salt: 'ghi789...',
            authTag: 'jkl012...',
          },
          index: 123,
        },
      };
    }

    // Select wallet service
    let service;
    let addressType: 'native-segwit' | 'legacy' = 'native-segwit'; // For Bitcoin
    switch (network.toLowerCase()) {
      case 'tron':
        service = this.tronWalletService;
        break;
      case 'ethereum':
        service = this.ethereumWalletService;
        break;
      case 'bitcoin':
        service = this.bitcoinWalletService;
        break;
      case 'solana':
        service = this.solanaWalletService;
        break;
      default:
        return {
          error: 'Invalid network',
          supportedNetworks: ['tron', 'ethereum', 'bitcoin', 'solana'],
        };
    }

    try {
      // Decrypt mnemonic
      const masterPassword = process.env.MASTER_ENCRYPTION_KEY || 'test-password-only-for-dev';
      const mnemonic = this.encryptionService.decrypt(encryptedMnemonic, masterPassword);

      // Validate mnemonic
      if (!service.validateMnemonic(mnemonic)) {
        return {
          error: 'Invalid mnemonic after decryption',
          hint: 'Check if MASTER_ENCRYPTION_KEY matches the one used during encryption',
        };
      }

      // Derive address at specified index
      let addressData;
      if (network.toLowerCase() === 'bitcoin') {
        addressData = service.deriveAddress(mnemonic, index, addressType);
      } else {
        addressData = service.deriveAddress(mnemonic, index);
      }

      // Return address info (no private keys!)
      return {
        success: true,
        network: network.toLowerCase(),
        address: addressData.address,
        derivation_path: addressData.derivationPath,
        index: addressData.index,
        // Additional network-specific info
        ...(network.toLowerCase() === 'tron' && {
          hex_address: this.tronWalletService.toHexAddress(addressData.address),
        }),
        ...(network.toLowerCase() === 'ethereum' && {
          checksum_address: this.ethereumWalletService.getChecksumAddress(addressData.address),
        }),
        ...(network.toLowerCase() === 'bitcoin' && {
          address_type: addressData.addressFormat,
        }),
        ...(network.toLowerCase() === 'solana' && {
          public_key: addressData.publicKey,
        }),
      };
    } catch (error) {
      return {
        error: 'Failed to derive address',
        message: error.message,
        hint: 'Ensure encrypted_mnemonic and MASTER_ENCRYPTION_KEY are correct',
      };
    }
  }

  // ==================== TEST ENDPOINTS (for development) ====================

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

  /**
   * Test endpoint: Generate a new Ethereum wallet
   * GET /api/wallets/ethereum/generate
   *
   * Query params:
   * - count: number of addresses to generate (default: 1)
   */
  @Get('ethereum/generate')
  generateEthereumWallet(@Query('count') count?: string) {
    const addressCount = count ? parseInt(count, 10) : 1;

    // Step 1: Generate new mnemonic
    const mnemonic = this.ethereumWalletService.generateMnemonic(12);

    // Step 2: Encrypt the mnemonic for safe storage
    const masterPassword = process.env.MASTER_ENCRYPTION_KEY || 'test-password-only-for-dev';
    const encryptedMnemonic = this.encryptionService.encrypt(mnemonic, masterPassword);

    // Step 3: Derive addresses
    const addresses = this.ethereumWalletService.deriveMultipleAddresses(
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
      message: 'Ethereum wallet generated successfully',
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
        privateKey: addr.privateKey,
      })),
      note: 'SECURITY WARNING: Private keys shown for testing only. Never expose in production!',
      supportedChains: ['Ethereum', 'BSC', 'Polygon', 'Arbitrum', 'Avalanche', 'Optimism'],
    };
  }

  /**
   * Test endpoint: Derive address from existing mnemonic
   * GET /api/wallets/ethereum/derive
   *
   * Query params:
   * - mnemonic: the seed phrase
   * - index: derivation index (default: 0)
   */
  @Get('ethereum/derive')
  deriveEthereumAddress(
    @Query('mnemonic') mnemonic: string,
    @Query('index') index?: string,
  ) {
    if (!mnemonic) {
      return {
        error: 'Mnemonic is required',
        example: '/api/wallets/ethereum/derive?mnemonic=your twelve word phrase here&index=0',
      };
    }

    // Validate mnemonic
    if (!this.ethereumWalletService.validateMnemonic(mnemonic)) {
      return {
        error: 'Invalid mnemonic phrase',
      };
    }

    const addressIndex = index ? parseInt(index, 10) : 0;
    const address = this.ethereumWalletService.deriveAddress(mnemonic, addressIndex);

    return {
      address: address.address,
      derivationPath: address.derivationPath,
      index: address.index,
      isValidAddress: this.ethereumWalletService.isValidAddress(address.address),
      checksumAddress: this.ethereumWalletService.getChecksumAddress(address.address),
    };
  }

  /**
   * Test endpoint: Validate an Ethereum address
   * GET /api/wallets/ethereum/validate?address=0x...
   */
  @Get('ethereum/validate')
  validateEthereumAddress(@Query('address') address: string) {
    if (!address) {
      return {
        error: 'Address is required',
        example: '/api/wallets/ethereum/validate?address=0xYour...Address',
      };
    }

    return {
      address,
      isValid: this.ethereumWalletService.isValidAddress(address),
      checksumAddress: this.ethereumWalletService.isValidAddress(address)
        ? this.ethereumWalletService.getChecksumAddress(address)
        : null,
    };
  }

  /**
   * Test endpoint: Generate a new Bitcoin wallet
   * GET /api/wallets/bitcoin/generate
   *
   * Query params:
   * - count: number of addresses to generate (default: 1)
   * - type: address type (native-segwit or legacy, default: native-segwit)
   */
  @Get('bitcoin/generate')
  generateBitcoinWallet(
    @Query('count') count?: string,
    @Query('type') type?: string,
  ) {
    const addressCount = count ? parseInt(count, 10) : 1;
    const addressType = (type === 'legacy' ? 'legacy' : 'native-segwit') as 'legacy' | 'native-segwit';

    // Step 1: Generate new mnemonic
    const mnemonic = this.bitcoinWalletService.generateMnemonic(12);

    // Step 2: Encrypt the mnemonic for safe storage
    const masterPassword = process.env.MASTER_ENCRYPTION_KEY || 'test-password-only-for-dev';
    const encryptedMnemonic = this.encryptionService.encrypt(mnemonic, masterPassword);

    // Step 3: Derive addresses
    const addresses = this.bitcoinWalletService.deriveMultipleAddresses(
      mnemonic,
      0,
      addressCount,
      addressType,
    );

    // Step 4: Test decryption
    const decryptedMnemonic = this.encryptionService.decrypt(
      encryptedMnemonic,
      masterPassword,
    );

    return {
      message: 'Bitcoin wallet generated successfully',
      addressType: addressType === 'legacy' ? 'Legacy (P2PKH)' : 'Native SegWit (Bech32)',
      mnemonic: {
        original: mnemonic,
        encrypted: encryptedMnemonic,
        decrypted: decryptedMnemonic,
        encryptionWorks: mnemonic === decryptedMnemonic,
      },
      addresses: addresses.map((addr) => ({
        address: addr.address,
        addressFormat: addr.addressFormat,
        derivationPath: addr.derivationPath,
        index: addr.index,
        publicKey: addr.publicKey,
        // WARNING: In production, NEVER expose private keys in API responses!
        privateKeyWIF: addr.privateKeyWIF,
        privateKeyHex: addr.privateKeyHex,
      })),
      note: 'SECURITY WARNING: Private keys shown for testing only. Never expose in production!',
    };
  }

  /**
   * Test endpoint: Derive address from existing mnemonic
   * GET /api/wallets/bitcoin/derive
   *
   * Query params:
   * - mnemonic: the seed phrase
   * - index: derivation index (default: 0)
   * - type: address type (native-segwit or legacy)
   */
  @Get('bitcoin/derive')
  deriveBitcoinAddress(
    @Query('mnemonic') mnemonic: string,
    @Query('index') index?: string,
    @Query('type') type?: string,
  ) {
    if (!mnemonic) {
      return {
        error: 'Mnemonic is required',
        example: '/api/wallets/bitcoin/derive?mnemonic=your twelve word phrase here&index=0&type=native-segwit',
      };
    }

    // Validate mnemonic
    if (!this.bitcoinWalletService.validateMnemonic(mnemonic)) {
      return {
        error: 'Invalid mnemonic phrase',
      };
    }

    const addressIndex = index ? parseInt(index, 10) : 0;
    const addressType = (type === 'legacy' ? 'legacy' : 'native-segwit') as 'legacy' | 'native-segwit';
    const address = this.bitcoinWalletService.deriveAddress(mnemonic, addressIndex, addressType);

    return {
      address: address.address,
      addressFormat: address.addressFormat,
      derivationPath: address.derivationPath,
      index: address.index,
      isValidAddress: this.bitcoinWalletService.isValidAddress(address.address),
      addressType: this.bitcoinWalletService.getAddressType(address.address),
    };
  }

  /**
   * Test endpoint: Validate a Bitcoin address
   * GET /api/wallets/bitcoin/validate?address=bc1...
   */
  @Get('bitcoin/validate')
  validateBitcoinAddress(@Query('address') address: string) {
    if (!address) {
      return {
        error: 'Address is required',
        example: '/api/wallets/bitcoin/validate?address=bc1qYour...Address',
      };
    }

    return {
      address,
      isValid: this.bitcoinWalletService.isValidAddress(address),
      addressType: this.bitcoinWalletService.isValidAddress(address)
        ? this.bitcoinWalletService.getAddressType(address)
        : null,
    };
  }

  /**
   * Test endpoint: Generate a new Solana wallet
   * GET /api/wallets/solana/generate
   *
   * Query params:
   * - count: number of addresses to generate (default: 1)
   */
  @Get('solana/generate')
  generateSolanaWallet(@Query('count') count?: string) {
    const addressCount = count ? parseInt(count, 10) : 1;

    // Step 1: Generate new mnemonic
    const mnemonic = this.solanaWalletService.generateMnemonic(12);

    // Step 2: Encrypt the mnemonic for safe storage
    const masterPassword = process.env.MASTER_ENCRYPTION_KEY || 'test-password-only-for-dev';
    const encryptedMnemonic = this.encryptionService.encrypt(mnemonic, masterPassword);

    // Step 3: Derive addresses
    const addresses = this.solanaWalletService.deriveMultipleAddresses(
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
      message: 'Solana wallet generated successfully',
      mnemonic: {
        original: mnemonic,
        encrypted: encryptedMnemonic,
        decrypted: decryptedMnemonic,
        encryptionWorks: mnemonic === decryptedMnemonic,
      },
      addresses: addresses.map((addr) => ({
        address: addr.address,
        publicKey: addr.publicKey,
        derivationPath: addr.derivationPath,
        index: addr.index,
        // WARNING: In production, NEVER expose private keys in API responses!
        privateKey: addr.privateKey,
      })),
      note: 'SECURITY WARNING: Private keys shown for testing only. Never expose in production!',
      supportedTokens: ['SOL', 'USDC', 'USDT', 'All SPL tokens'],
    };
  }

  /**
   * Test endpoint: Derive address from existing mnemonic
   * GET /api/wallets/solana/derive
   *
   * Query params:
   * - mnemonic: the seed phrase
   * - index: derivation index (default: 0)
   */
  @Get('solana/derive')
  deriveSolanaAddress(
    @Query('mnemonic') mnemonic: string,
    @Query('index') index?: string,
  ) {
    if (!mnemonic) {
      return {
        error: 'Mnemonic is required',
        example: '/api/wallets/solana/derive?mnemonic=your twelve word phrase here&index=0',
      };
    }

    // Validate mnemonic
    if (!this.solanaWalletService.validateMnemonic(mnemonic)) {
      return {
        error: 'Invalid mnemonic phrase',
      };
    }

    const addressIndex = index ? parseInt(index, 10) : 0;
    const address = this.solanaWalletService.deriveAddress(mnemonic, addressIndex);

    return {
      address: address.address,
      publicKey: address.publicKey,
      derivationPath: address.derivationPath,
      index: address.index,
      isValidAddress: this.solanaWalletService.isValidAddress(address.address),
    };
  }

  /**
   * Test endpoint: Validate a Solana address
   * GET /api/wallets/solana/validate?address=...
   */
  @Get('solana/validate')
  validateSolanaAddress(@Query('address') address: string) {
    if (!address) {
      return {
        error: 'Address is required',
        example: '/api/wallets/solana/validate?address=YourSolanaAddress',
      };
    }

    return {
      address,
      isValid: this.solanaWalletService.isValidAddress(address),
    };
  }
}

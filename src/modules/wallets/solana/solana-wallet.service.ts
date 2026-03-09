import { Injectable } from '@nestjs/common';
import * as bip39 from 'bip39';
import { Keypair, PublicKey } from '@solana/web3.js';
import { derivePath } from 'ed25519-hd-key';

/**
 * SolanaWalletService - Handles Solana HD wallet operations
 *
 * Solana Differences:
 * - Uses Ed25519 keys (not secp256k1 like Bitcoin/Ethereum)
 * - Addresses are Base58 encoded public keys
 * - Path: m/44'/501'/0'/{index}' (all hardened)
 *
 * Works for:
 * - SOL (native Solana)
 * - SPL tokens (USDC, USDT, etc.)
 */
@Injectable()
export class SolanaWalletService {
  // Solana BIP44 derivation path (all hardened derivation)
  // 501 is Solana's coin type
  private readonly DERIVATION_PATH_BASE = "m/44'/501'";

  /**
   * Generate a new mnemonic phrase
   *
   * @param wordCount - 12 or 24 words (default: 12)
   * @returns A mnemonic phrase
   */
  generateMnemonic(wordCount: 12 | 24 = 12): string {
    const strength = wordCount === 12 ? 128 : 256;
    return bip39.generateMnemonic(strength);
  }

  /**
   * Validate a mnemonic phrase
   *
   * @param mnemonic - The mnemonic to validate
   * @returns true if valid, false otherwise
   */
  validateMnemonic(mnemonic: string): boolean {
    return bip39.validateMnemonic(mnemonic);
  }

  /**
   * Derive a Solana address from mnemonic at a specific index
   *
   * @param mnemonic - The master mnemonic phrase
   * @param index - The derivation index (0, 1, 2, ...)
   * @returns Object with address and private key
   */
  deriveAddress(mnemonic: string, index: number): SolanaAddress {
    // Step 1: Convert mnemonic to seed
    const seed = bip39.mnemonicToSeedSync(mnemonic, ''); // No passphrase

    // Step 2: Build derivation path
    // Solana uses: m/44'/501'/account'/change'
    // For simplicity, we use: m/44'/501'/index'/0'
    const path = `${this.DERIVATION_PATH_BASE}/${index}'/0'`;

    // Step 3: Derive key using Ed25519
    const derivedSeed = derivePath(path, seed.toString('hex')).key;

    // Step 4: Create Keypair from derived seed
    const keypair = Keypair.fromSeed(derivedSeed);

    // Step 5: Get address (public key in Base58)
    const address = keypair.publicKey.toBase58();

    // Step 6: Get private key (secret key)
    const privateKey = Buffer.from(keypair.secretKey).toString('hex');

    return {
      address, // Base58 encoded public key
      publicKey: keypair.publicKey.toBase58(),
      privateKey, // Full secret key (64 bytes in hex)
      derivationPath: path,
      index,
    };
  }

  /**
   * Derive multiple addresses at once
   *
   * @param mnemonic - The master mnemonic phrase
   * @param startIndex - Starting index (default: 0)
   * @param count - Number of addresses to generate (default: 10)
   * @returns Array of addresses
   */
  deriveMultipleAddresses(
    mnemonic: string,
    startIndex: number = 0,
    count: number = 10,
  ): SolanaAddress[] {
    const addresses: SolanaAddress[] = [];

    for (let i = startIndex; i < startIndex + count; i++) {
      addresses.push(this.deriveAddress(mnemonic, i));
    }

    return addresses;
  }

  /**
   * Get address from private key
   *
   * @param privateKeyHex - Hex encoded private key (64 bytes = 128 hex chars)
   * @returns Solana address
   */
  getAddressFromPrivateKey(privateKeyHex: string): string {
    const secretKey = Buffer.from(privateKeyHex, 'hex');
    const keypair = Keypair.fromSecretKey(secretKey);
    return keypair.publicKey.toBase58();
  }

  /**
   * Validate a Solana address
   *
   * @param address - Address to validate
   * @returns true if valid Solana address
   */
  isValidAddress(address: string): boolean {
    try {
      new PublicKey(address);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Get keypair from private key (for signing transactions)
   *
   * @param privateKeyHex - Hex encoded private key
   * @returns Keypair object
   */
  getKeypairFromPrivateKey(privateKeyHex: string): Keypair {
    const secretKey = Buffer.from(privateKeyHex, 'hex');
    return Keypair.fromSecretKey(secretKey);
  }

  /**
   * Get public key from address string
   *
   * @param address - Base58 address
   * @returns PublicKey object
   */
  getPublicKey(address: string): PublicKey {
    return new PublicKey(address);
  }

  /**
   * Get master public key for watch-only wallets
   * Note: Solana doesn't use extended public keys like Bitcoin
   * This returns the public key at account 0
   *
   * @param mnemonic - The master mnemonic
   * @returns Base58 encoded public key
   */
  getMasterPublicKey(mnemonic: string): string {
    const seed = bip39.mnemonicToSeedSync(mnemonic, '');
    const path = `${this.DERIVATION_PATH_BASE}/0'/0'`;
    const derivedSeed = derivePath(path, seed.toString('hex')).key;
    const keypair = Keypair.fromSeed(derivedSeed);
    return keypair.publicKey.toBase58();
  }

  /**
   * Create a new random keypair (not from mnemonic)
   * Useful for temporary/burner wallets
   *
   * @returns New keypair
   */
  generateRandomKeypair(): Keypair {
    return Keypair.generate();
  }
}

/**
 * Interface for Solana address information
 */
export interface SolanaAddress {
  address: string; // Base58 encoded public key
  publicKey: string; // Same as address (Base58)
  privateKey: string; // Hex encoded secret key (64 bytes)
  derivationPath: string; // BIP44 derivation path used
  index: number; // Address index
}

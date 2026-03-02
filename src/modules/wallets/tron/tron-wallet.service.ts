import { Injectable } from '@nestjs/common';
import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
const TronWeb = require('tronweb').default || require('tronweb');

/**
 * TronWalletService - Handles Tron HD wallet operations
 *
 * HD (Hierarchical Deterministic) Wallet:
 * - One master seed generates unlimited addresses
 * - Each address is derived using a path: m/44'/195'/0'/0/{index}
 * - Same seed + same path = same address (deterministic)
 */
@Injectable()
export class TronWalletService {
  // Tron uses the same derivation as Ethereum but with Tron's coin type
  // BIP44 path: m/purpose'/coin_type'/account'/change/address_index
  // 44' = BIP44 standard
  // 195' = Tron coin type
  // 0' = first account
  // 0 = external chain (not change addresses)
  private readonly DERIVATION_PATH = "m/44'/195'/0'/0";

  // TronWeb instance for address utilities
  private tronWeb: any;

  constructor() {
    // Initialize TronWeb (we don't need a full node for address generation)
    this.tronWeb = new TronWeb({
      fullHost: 'https://api.trongrid.io', // We'll use this for utilities only
    });
  }

  /**
   * Generate a new mnemonic phrase
   *
   * @param wordCount - 12 or 24 words (default: 12)
   * @returns A mnemonic phrase (12 or 24 words)
   */
  generateMnemonic(wordCount: 12 | 24 = 12): string {
    // 12 words = 128 bits of entropy
    // 24 words = 256 bits of entropy
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
   * Derive a Tron address from mnemonic at a specific index
   *
   * @param mnemonic - The master mnemonic phrase
   * @param index - The derivation index (0, 1, 2, ...)
   * @returns Object with address and private key
   */
  deriveAddress(mnemonic: string, index: number): TronAddress {
    // Step 1: Convert mnemonic to seed (512-bit)
    const seed = bip39.mnemonicToSeedSync(mnemonic);

    // Step 2: Create BIP32 instance with elliptic curve cryptography
    const bip32 = BIP32Factory(ecc);

    // Step 3: Create master key from seed
    const root = bip32.fromSeed(seed);

    // Step 4: Derive child key at specific path
    // Example: m/44'/195'/0'/0/0 (first address)
    //          m/44'/195'/0'/0/1 (second address)
    const path = `${this.DERIVATION_PATH}/${index}`;
    const child = root.derivePath(path);

    // Step 5: Get private key from derived child
    if (!child.privateKey) {
      throw new Error('Failed to derive private key');
    }

    const privateKey = Buffer.from(child.privateKey).toString('hex');

    // Step 6: Generate Tron address from private key
    // TronWeb handles the conversion to Tron's base58 format
    const address = this.tronWeb.address.fromPrivateKey(privateKey);

    return {
      address,
      privateKey,
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
  ): TronAddress[] {
    const addresses: TronAddress[] = [];

    for (let i = startIndex; i < startIndex + count; i++) {
      addresses.push(this.deriveAddress(mnemonic, i));
    }

    return addresses;
  }

  /**
   * Get address from private key only
   * Useful when you have the private key but need the address
   *
   * @param privateKey - Hex encoded private key
   * @returns Tron address
   */
  getAddressFromPrivateKey(privateKey: string): string {
    return this.tronWeb.address.fromPrivateKey(privateKey);
  }

  /**
   * Validate a Tron address format
   *
   * @param address - Address to validate
   * @returns true if valid Tron address
   */
  isValidAddress(address: string): boolean {
    return this.tronWeb.isAddress(address);
  }

  /**
   * Convert Tron address to hex format
   * Tron uses base58 format (starts with T), but sometimes you need hex
   *
   * @param address - Base58 Tron address
   * @returns Hex address
   */
  toHexAddress(address: string): string {
    return this.tronWeb.address.toHex(address);
  }

  /**
   * Get master public key for watch-only wallets
   * This allows generating addresses without exposing private keys
   *
   * @param mnemonic - The master mnemonic
   * @returns Extended public key (xpub)
   */
  getMasterPublicKey(mnemonic: string): string {
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const bip32 = BIP32Factory(ecc);
    const root = bip32.fromSeed(seed);
    const masterNode = root.derivePath(this.DERIVATION_PATH);

    return masterNode.neutered().toBase58(); // neutered() removes private key
  }
}

/**
 * Interface for Tron address information
 */
export interface TronAddress {
  address: string; // Base58 Tron address (starts with T)
  privateKey: string; // Hex encoded private key
  derivationPath: string; // BIP44 derivation path used
  index: number; // Address index
}

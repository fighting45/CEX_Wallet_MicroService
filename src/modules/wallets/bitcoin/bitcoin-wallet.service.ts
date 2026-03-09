import { Injectable } from '@nestjs/common';
import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import ECPairFactory from 'ecpair';

/**
 * BitcoinWalletService - Handles Bitcoin HD wallet operations
 *
 * Bitcoin Address Types:
 * - Legacy (P2PKH): Starts with 1, path: m/44'/0'/0'/0/{index}
 * - SegWit (P2SH-P2WPKH): Starts with 3, path: m/49'/0'/0'/0/{index}
 * - Native SegWit (Bech32): Starts with bc1, path: m/84'/0'/0'/0/{index}
 *
 * We use Native SegWit (bc1) by default for lower fees
 */
@Injectable()
export class BitcoinWalletService {
  // Native SegWit (Bech32) - Recommended for new addresses
  private readonly NATIVE_SEGWIT_PATH = "m/84'/0'/0'/0";
  // Legacy path for compatibility
  private readonly LEGACY_PATH = "m/44'/0'/0'/0";

  // Bitcoin network (mainnet or testnet)
  private readonly network = bitcoin.networks.bitcoin; // Change to bitcoin.networks.testnet for testing

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
   * Derive a Bitcoin address from mnemonic at a specific index
   *
   * @param mnemonic - The master mnemonic phrase
   * @param index - The derivation index (0, 1, 2, ...)
   * @param addressType - Type of address to generate (default: 'native-segwit')
   * @returns Object with address and private key
   */
  deriveAddress(
    mnemonic: string,
    index: number,
    addressType: 'legacy' | 'native-segwit' = 'native-segwit',
  ): BitcoinAddress {
    // Step 1: Convert mnemonic to seed
    const seed = bip39.mnemonicToSeedSync(mnemonic);

    // Step 2: Create BIP32 instance
    const bip32 = BIP32Factory(ecc);
    const root = bip32.fromSeed(seed, this.network);

    // Step 3: Select derivation path based on address type
    const basePath = addressType === 'legacy' ? this.LEGACY_PATH : this.NATIVE_SEGWIT_PATH;
    const path = `${basePath}/${index}`;

    // Step 4: Derive child key
    const child = root.derivePath(path);

    if (!child.privateKey) {
      throw new Error('Failed to derive private key');
    }

    // Step 5: Generate address based on type
    let address: string;
    let addressFormat: string;

    if (addressType === 'legacy') {
      // P2PKH - Legacy address (starts with 1)
      const payment = bitcoin.payments.p2pkh({
        pubkey: child.publicKey,
        network: this.network,
      });
      address = payment.address!;
      addressFormat = 'P2PKH (Legacy)';
    } else {
      // P2WPKH - Native SegWit (starts with bc1)
      const payment = bitcoin.payments.p2wpkh({
        pubkey: child.publicKey,
        network: this.network,
      });
      address = payment.address!;
      addressFormat = 'P2WPKH (Native SegWit)';
    }

    // Step 6: Get WIF (Wallet Import Format) for private key
    const privateKeyWIF = child.toWIF();
    const privateKeyHex = Buffer.from(child.privateKey).toString('hex');

    return {
      address,
      addressFormat,
      privateKeyWIF, // Standard format for Bitcoin wallets
      privateKeyHex, // Hex format
      publicKey: Buffer.from(child.publicKey).toString('hex'),
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
   * @param addressType - Type of addresses to generate
   * @returns Array of addresses
   */
  deriveMultipleAddresses(
    mnemonic: string,
    startIndex: number = 0,
    count: number = 10,
    addressType: 'legacy' | 'native-segwit' = 'native-segwit',
  ): BitcoinAddress[] {
    const addresses: BitcoinAddress[] = [];

    for (let i = startIndex; i < startIndex + count; i++) {
      addresses.push(this.deriveAddress(mnemonic, i, addressType));
    }

    return addresses;
  }

  /**
   * Get address from WIF (Wallet Import Format) private key
   *
   * @param wif - Private key in WIF format
   * @param addressType - Type of address to generate
   * @returns Bitcoin address
   */
  getAddressFromWIF(
    wif: string,
    addressType: 'legacy' | 'native-segwit' = 'native-segwit',
  ): string {
    const ECPair = ECPairFactory(ecc);
    const keyPair = ECPair.fromWIF(wif, this.network);

    if (addressType === 'legacy') {
      const payment = bitcoin.payments.p2pkh({
        pubkey: keyPair.publicKey,
        network: this.network,
      });
      return payment.address!;
    } else {
      const payment = bitcoin.payments.p2wpkh({
        pubkey: keyPair.publicKey,
        network: this.network,
      });
      return payment.address!;
    }
  }

  /**
   * Validate a Bitcoin address
   *
   * @param address - Address to validate
   * @returns true if valid Bitcoin address
   */
  isValidAddress(address: string): boolean {
    try {
      bitcoin.address.toOutputScript(address, this.network);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Get address type from address string
   *
   * @param address - Bitcoin address
   * @returns Address type
   */
  getAddressType(address: string): string {
    if (address.startsWith('1')) {
      return 'P2PKH (Legacy)';
    } else if (address.startsWith('3')) {
      return 'P2SH (SegWit)';
    } else if (address.startsWith('bc1')) {
      return 'P2WPKH (Native SegWit)';
    }
    return 'Unknown';
  }

  /**
   * Get master public key for watch-only wallets
   *
   * @param mnemonic - The master mnemonic
   * @param addressType - Address type for derivation path
   * @returns Extended public key (xpub)
   */
  getMasterPublicKey(
    mnemonic: string,
    addressType: 'legacy' | 'native-segwit' = 'native-segwit',
  ): string {
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const bip32 = BIP32Factory(ecc);
    const root = bip32.fromSeed(seed, this.network);

    const basePath = addressType === 'legacy' ? this.LEGACY_PATH : this.NATIVE_SEGWIT_PATH;
    const masterNode = root.derivePath(basePath);

    return masterNode.neutered().toBase58();
  }
}

/**
 * Interface for Bitcoin address information
 */
export interface BitcoinAddress {
  address: string; // Bitcoin address (1..., 3..., or bc1...)
  addressFormat: string; // Address type description
  privateKeyWIF: string; // Private key in WIF format (standard for BTC)
  privateKeyHex: string; // Private key in hex format
  publicKey: string; // Public key in hex format
  derivationPath: string; // BIP44/84 derivation path used
  index: number; // Address index
}

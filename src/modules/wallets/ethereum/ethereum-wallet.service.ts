import { Injectable } from '@nestjs/common';
import * as bip39 from 'bip39';
import { ethers } from 'ethers';

/**
 * EthereumWalletService - Handles Ethereum HD wallet operations
 *
 * HD Wallet Path: m/44'/60'/0'/0/{index}
 * - 44' = BIP44 standard
 * - 60' = Ethereum coin type
 * - 0' = first account
 * - 0 = external addresses
 * - {index} = address index (0, 1, 2, 3...)
 *
 * Works for ALL EVM-compatible chains:
 * - Ethereum
 * - BSC (Binance Smart Chain)
 * - Polygon
 * - Arbitrum
 * - Avalanche
 * - etc.
 */
@Injectable()
export class EthereumWalletService {
  // Ethereum BIP44 derivation path
  private readonly DERIVATION_PATH = "m/44'/60'/0'/0";

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
   * Derive an Ethereum address from mnemonic at a specific index
   *
   * @param mnemonic - The master mnemonic phrase
   * @param index - The derivation index (0, 1, 2, ...)
   * @returns Object with address and private key
   */
  deriveAddress(mnemonic: string, index: number): EthereumAddress {
    // Step 1: Build the full path
    // Example: m/44'/60'/0'/0/0 (first address)
    const path = `${this.DERIVATION_PATH}/${index}`;

    // Step 2: Derive wallet directly from mnemonic using full path
    // ethers.js creates the master node and derives in one step
    const wallet = ethers.HDNodeWallet.fromPhrase(mnemonic, path);

    // Step 3: Get address and private key
    return {
      address: wallet.address, // Checksummed Ethereum address (0x...)
      privateKey: wallet.privateKey, // Hex string with 0x prefix
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
  ): EthereumAddress[] {
    const addresses: EthereumAddress[] = [];

    for (let i = startIndex; i < startIndex + count; i++) {
      addresses.push(this.deriveAddress(mnemonic, i));
    }

    return addresses;
  }

  /**
   * Get address from private key
   *
   * @param privateKey - Hex encoded private key (with or without 0x prefix)
   * @returns Ethereum address
   */
  getAddressFromPrivateKey(privateKey: string): string {
    const wallet = new ethers.Wallet(privateKey);
    return wallet.address;
  }

  /**
   * Validate an Ethereum address
   *
   * @param address - Address to validate
   * @returns true if valid Ethereum address
   */
  isValidAddress(address: string): boolean {
    return ethers.isAddress(address);
  }

  /**
   * Get checksummed address (proper capitalization)
   * Ethereum addresses are case-sensitive for checksum validation
   *
   * @param address - Address to checksum
   * @returns Checksummed address
   */
  getChecksumAddress(address: string): string {
    return ethers.getAddress(address);
  }

  /**
   * Sign a message with private key
   * Useful for proving ownership
   *
   * @param message - Message to sign
   * @param privateKey - Private key to sign with
   * @returns Signature
   */
  signMessage(message: string, privateKey: string): string {
    const wallet = new ethers.Wallet(privateKey);
    return wallet.signMessageSync(message);
  }

  /**
   * Verify a signed message
   *
   * @param message - Original message
   * @param signature - Signature to verify
   * @returns Address that signed the message
   */
  verifyMessage(message: string, signature: string): string {
    return ethers.verifyMessage(message, signature);
  }

  /**
   * Get master public key for watch-only wallets
   *
   * @param mnemonic - The master mnemonic
   * @returns Extended public key (xpub)
   */
  getMasterPublicKey(mnemonic: string): string {
    const masterNode = ethers.HDNodeWallet.fromPhrase(mnemonic, this.DERIVATION_PATH);
    return masterNode.neuter().extendedKey;
  }

  /**
   * Check if address is a contract or EOA (Externally Owned Account)
   * Note: This requires a provider connection to check on-chain
   *
   * @param address - Address to check
   * @param rpcUrl - RPC endpoint URL
   * @returns true if contract, false if EOA
   */
  async isContract(address: string, rpcUrl: string): Promise<boolean> {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const code = await provider.getCode(address);
    return code !== '0x';
  }
}

/**
 * Interface for Ethereum address information
 */
export interface EthereumAddress {
  address: string; // Checksummed Ethereum address (0x...)
  privateKey: string; // Hex encoded private key with 0x prefix
  derivationPath: string; // BIP44 derivation path used
  index: number; // Address index
}

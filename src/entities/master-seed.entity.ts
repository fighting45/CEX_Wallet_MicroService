import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * MasterSeed Entity
 *
 * Stores encrypted master mnemonics for HD wallet generation
 * One master seed per blockchain network for the entire exchange
 *
 * CRITICAL SECURITY:
 * - Mnemonic is encrypted with AES-256-GCM
 * - Never expose in API responses
 * - Access restricted to wallet generation service only
 */
@Entity('master_seeds')
export class MasterSeed {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'varchar',
    length: 20,
    unique: true,
    comment: 'Blockchain network: tron, ethereum, bitcoin, solana',
  })
  network: string;

  @Column({
    type: 'text',
    comment: 'AES-256-GCM encrypted mnemonic',
  })
  encrypted_mnemonic: string;

  @Column({
    type: 'varchar',
    length: 64,
    comment: 'Encryption IV (hex)',
  })
  encryption_iv: string;

  @Column({
    type: 'varchar',
    length: 64,
    comment: 'Encryption salt (hex)',
  })
  encryption_salt: string;

  @Column({
    type: 'varchar',
    length: 64,
    comment: 'Encryption auth tag (hex)',
  })
  encryption_auth_tag: string;

  @Column({
    type: 'int',
    default: 0,
    comment: 'Next derivation index to use for new user',
  })
  next_index: number;

  @Column({
    type: 'varchar',
    length: 100,
    comment: 'Derivation path template (e.g., m/44\'/195\'/0\'/0/{index})',
  })
  derivation_path_template: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'hot',
    comment: 'Wallet tier: hot, warm, cold',
  })
  wallet_tier: string;

  @Column({
    type: 'boolean',
    default: true,
    comment: 'Is this master seed active?',
  })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

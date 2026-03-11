import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * WalletAddress Entity
 *
 * Maps users to their blockchain addresses
 * Each user has one address per network
 *
 * Example:
 * User 123 → Tron: TYour123..., Ethereum: 0xYour123..., Bitcoin: bc1qYour123...
 */
@Entity('wallet_addresses')
@Index(['user_id', 'network'], { unique: true }) // One address per user per network
@Index(['address']) // Fast lookups by address (for deposit detection)
export class WalletAddress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'int',
    comment: 'User ID from main exchange database',
  })
  user_id: number;

  @Column({
    type: 'varchar',
    length: 20,
    comment: 'Blockchain network: tron, ethereum, bitcoin, solana',
  })
  network: string;

  @Column({
    type: 'varchar',
    length: 100,
    unique: true,
    comment: 'Blockchain address',
  })
  address: string;

  @Column({
    type: 'int',
    comment: 'HD derivation index (matches user_id in most cases)',
  })
  derivation_index: number;

  @Column({
    type: 'varchar',
    length: 100,
    comment: 'Full derivation path used',
  })
  derivation_path: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'hd',
    comment: 'Address type: hd (HD wallet) or legacy (migrated)',
  })
  address_type: string;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
    comment: 'For Bitcoin: native-segwit or legacy',
  })
  address_format: string | null;

  @Column({
    type: 'decimal',
    precision: 36,
    scale: 18,
    default: 0,
    comment: 'Total amount ever received (for reconciliation)',
  })
  total_received: string;

  @Column({
    type: 'boolean',
    default: true,
    comment: 'Is this address active for deposits?',
  })
  is_active: boolean;

  @Column({
    type: 'timestamp',
    nullable: true,
    comment: 'Last time deposit was detected',
  })
  last_deposit_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * Transaction Entity
 *
 * Records all deposits and withdrawals
 *
 * Transaction Flow:
 * Deposit: pending → confirmed → swept
 * Withdrawal: pending → processing → broadcasted → confirmed
 */
@Entity('transactions')
@Index(['user_id'])
@Index(['tx_hash'], { unique: true })
@Index(['network', 'status'])
@Index(['type', 'status'])
export class Transaction {
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
    length: 20,
    comment: 'Coin symbol: TRX, USDT, ETH, BTC, SOL, etc.',
  })
  coin_symbol: string;

  @Column({
    type: 'varchar',
    length: 20,
    comment: 'Transaction type: deposit or withdrawal',
  })
  type: 'deposit' | 'withdrawal';

  @Column({
    type: 'decimal',
    precision: 36,
    scale: 18,
    comment: 'Transaction amount',
  })
  amount: string;

  @Column({
    type: 'decimal',
    precision: 36,
    scale: 18,
    default: 0,
    comment: 'Network fee paid',
  })
  fee: string;

  @Column({
    type: 'varchar',
    length: 100,
    comment: 'Source address (for deposits: user address, for withdrawals: hot wallet)',
  })
  from_address: string;

  @Column({
    type: 'varchar',
    length: 100,
    comment: 'Destination address (for deposits: user address, for withdrawals: external)',
  })
  to_address: string;

  @Column({
    type: 'varchar',
    length: 255,
    unique: true,
    nullable: true,
    comment: 'Blockchain transaction hash',
  })
  tx_hash: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    comment: 'Status: pending, confirmed, failed, swept (deposits), processing, broadcasted (withdrawals)',
  })
  status: string;

  @Column({
    type: 'int',
    default: 0,
    comment: 'Number of confirmations',
  })
  confirmations: number;

  @Column({
    type: 'int',
    comment: 'Required confirmations for this network',
  })
  required_confirmations: number;

  @Column({
    type: 'boolean',
    default: false,
    comment: 'Has this deposit been swept to hot wallet?',
  })
  swept: boolean;

  @Column({
    type: 'timestamp',
    nullable: true,
    comment: 'When was this deposit swept?',
  })
  swept_at: Date | null;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'Sweep transaction hash (if swept)',
  })
  sweep_tx_hash: string | null;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'Idempotency key for withdrawals (prevent duplicates)',
  })
  idempotency_key: string | null;

  @Column({
    type: 'text',
    nullable: true,
    comment: 'Error message if transaction failed',
  })
  error_message: string | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    comment: 'Additional metadata (block number, gas used, etc.)',
  })
  metadata: any;

  @Column({
    type: 'timestamp',
    nullable: true,
    comment: 'When transaction was confirmed on blockchain',
  })
  confirmed_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * WalletBalance Entity
 *
 * Tracks user balances per network and coin
 * This is the SOURCE OF TRUTH for user balances (not on-chain balance)
 *
 * Balance States:
 * - total = available + locked
 * - available: can trade/withdraw
 * - locked: in open orders or pending withdrawals
 */
@Entity('wallet_balances')
@Index(['user_id', 'network', 'coin_symbol'], { unique: true })
@Index(['user_id'])
export class WalletBalance {
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
    type: 'decimal',
    precision: 36,
    scale: 18,
    default: 0,
    comment: 'Total balance (available + locked)',
  })
  balance: string;

  @Column({
    type: 'decimal',
    precision: 36,
    scale: 18,
    default: 0,
    comment: 'Available balance (can trade/withdraw)',
  })
  available: string;

  @Column({
    type: 'decimal',
    precision: 36,
    scale: 18,
    default: 0,
    comment: 'Locked balance (in orders or pending withdrawal)',
  })
  locked: string;

  @Column({
    type: 'decimal',
    precision: 36,
    scale: 18,
    default: 0,
    comment: 'Total deposited (all-time)',
  })
  total_deposited: string;

  @Column({
    type: 'decimal',
    precision: 36,
    scale: 18,
    default: 0,
    comment: 'Total withdrawn (all-time)',
  })
  total_withdrawn: string;

  @Column({
    type: 'timestamp',
    nullable: true,
    comment: 'Last reconciliation check timestamp',
  })
  last_reconciled_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

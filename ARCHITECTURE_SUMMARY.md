## Complete System Flow

### 1. Initial Setup (One-Time)

```
┌─────────────────────────────────────────────┐
│ Step 1: Generate Master Seeds (Laravel)     │
│                                             │
│ Laravel calls:                              │
│ GET /api/wallets/tron/generate              │
│ GET /api/wallets/ethereum/generate          │
│ GET /api/wallets/bitcoin/generate           │
│ GET /api/wallets/solana/generate            │
│                                             │
│ Wallet Service responds with mnemonics      │
│                                             │
│ Laravel encrypts and stores in:             │
│ master_seeds table                          │
└─────────────────────────────────────────────┘
```

**Laravel Code:**

```php
// Run once per network
WalletSetupService::generateMasterSeed('tron');
WalletSetupService::generateMasterSeed('ethereum');
WalletSetupService::generateMasterSeed('bitcoin');
WalletSetupService::generateMasterSeed('solana');
```

---

### 2. User Requests Deposit Address

```
┌─────────────────────────────────────────────┐
│ User: "I want to deposit USDT on Tron"      │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ Laravel checks: Does user have Tron address?│
│ → No, generate new one                      │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ Laravel:                                    │
│ 1. Get Tron master mnemonic from DB         │
│ 2. Get next_index (e.g., 1523)              │
│ 3. Call wallet service:                     │
│    GET /wallets/tron/derive?                │
│        mnemonic=xxx&index=1523              │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ Wallet Service:                             │
│ 1. Derives address from mnemonic + index    │
│ 2. Returns: { address: "TUser1523..." }    │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ Laravel:                                    │
│ 1. Stores address in wallet_addresses table │
│ 2. Increments next_index (1523 → 1524)     │
│ 3. Returns address to user                 │
└─────────────────────────────────────────────┘
```

**Result:** User sees: "Deposit to: TUser1523..."

---

### 3. User Deposits Funds

```
┌─────────────────────────────────────────────┐
│ User sends 100 USDT to TUser1523...         │
│ (using their personal wallet like Trust)    │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ Tron Blockchain: Transaction pending...     │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ Wallet Service Listener (runs 24/7):       │
│ 1. Checks TUser1523... every 30 seconds     │
│ 2. Detects new transaction!                 │
│ 3. Inserts into transactions table:         │
│    - amount: 100 USDT                       │
│    - status: pending                        │
│    - confirmations: 0                       │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ Wait for 19 confirmations...                │
│ (Listener keeps checking)                   │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ 19 Confirmations Reached!                   │
│                                             │
│ Laravel:                                    │
│ 1. UPDATE transactions SET status='confirmed'│
│ 2. UPDATE wallet_balances:                  │
│    available = available + 100              │
│ 3. Notify user: "Deposit confirmed!"       │
└─────────────────────────────────────────────┘
```

**Result:** User's balance: **100 USDT available**

---

### 4. Sweep Service (Move to Hot Wallet)

```
┌─────────────────────────────────────────────┐
│ Cron Job (every 2 hours):                   │
│ Laravel Sweep Service runs                  │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ Laravel queries:                            │
│ "Which addresses have confirmed deposits    │
│  that haven't been swept?"                  │
│                                             │
│ Result: TUser1523... has 100 USDT           │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ Laravel:                                    │
│ 1. Get  Tron master mnemonic                │
│ 2. Call wallet service:                     │
│    POST /wallets/tron/sign-transaction      │
│    {                                        │
│      mnemonic: "xxx",                       │
│      index: 1523,                           │
│      to: "THotWallet...",                   │
│      amount: 100                            │
│    }                                        │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ Wallet Service:                             │
│ 1. Derives private key (mnemonic + index)   │
│ 2. Signs transaction                        │
│ 3. Returns signed transaction               │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ Laravel:                                    │
│ 1. Broadcasts signed tx to Tron blockchain  │
│ 2. Gets tx_hash                             │
│ 3. UPDATE transactions SET swept=true       │
└─────────────────────────────────────────────┘
```

**Result:**

- User address (TUser1523...) balance: **0 USDT** (swept)
- Hot wallet balance: **+100 USDT**
- User's database balance: **Still 100 USDT** (unchanged)

---

### 5. User Withdraws Funds

```
┌─────────────────────────────────────────────┐
│ User: "Withdraw 50 USDT to my Trust Wallet" │
│ External address: TExternal456...           │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ Laravel Withdrawal Service:                 │
│ 1. Check user balance: 100 USDT ✅          │
│ 2. Lock 50 USDT:                            │
│    available: 100 → 50                      │
│    locked: 0 → 50                           │
│ 3. Create withdrawal transaction (pending)  │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ Laravel calls wallet service:               │
│ POST /wallets/tron/sign-transaction         │
│ {                                           │
│   mnemonic: "xxx",                          │
│   index: 0,  ← Hot wallet index             │
│   to: "TExternal456...",                    │
│   amount: 50                                │
│ }                                           │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ Wallet Service:                             │
│ 1. Derives HOT WALLET private key           │
│ 2. Signs transaction (from hot wallet)      │
│ 3. Returns signed tx                        │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ Laravel:                                    │
│ 1. Broadcasts to blockchain                 │
│ 2. Gets tx_hash                             │
│ 3. UPDATE wallet_balances:                  │
│    locked: 50 → 0                           │
│    balance: 100 → 50                        │
│    total_withdrawn: +50                     │
│ 4. UPDATE transaction: status=broadcasted   │
└─────────────────────────────────────────────┘
```

**Result:**

- User's balance: **50 USDT** (withdrawn 50)
- Hot wallet: **-50 USDT**
- External wallet (TExternal456...): **+50 USDT**

---

## Key Concepts

### Master Seed Strategy

```
Network: Tron
Master Mnemonic: "word1 word2 word3... word12"
  ├─ Index 0 → THotWallet... (Hot Wallet)
  ├─ Index 1 → TUser1... (User 1's deposit address)
  ├─ Index 2 → TUser2... (User 2's deposit address)
  ├─ Index 3 → TUser3... (User 3's deposit address)
  └─ Index 1523 → TUser1523... (User 1523's deposit address)
```

**Each network has ONE master mnemonic for entire exchange**

### Hot Wallet Architecture

```
User Deposit Addresses (Index 1-999999...)
  ↓ (Sweep every 2 hours)
Hot Wallet (Index 0)
  ↓ (Withdrawals)
External User Wallets
```

### Database vs On-Chain Balance

| Location                       | User Balance | Hot Wallet Balance |
| ------------------------------ | ------------ | ------------------ |
| **Database** (source of truth) | 100 USDT     | N/A                |
| **On-Chain** (after sweep)     | 0 USDT       | 100 USDT           |

**Important:** User's **database balance** is what matters for trading/withdrawing!

---

## API Endpoints Summary

### Wallet Service Provides:

| Endpoint                                   | Purpose                              | Used By Laravel                 |
| ------------------------------------------ | ------------------------------------ | ------------------------------- |
| `GET /wallets/{network}/generate`          | Generate master mnemonic             | Once per network (setup)        |
| `GET /wallets/{network}/derive`            | Derive address from mnemonic + index | When user needs deposit address |
| `GET /wallets/{network}/validate`          | Validate address format              | Before withdrawal               |
| `POST /wallets/{network}/sign-transaction` | Sign transaction                     | Sweep & withdrawal              |

---

## What's Next?

### Immediate Next Steps:

1. ✅ **Wallet service is ready** - All crypto operations work
2. ⏳ **Laravel database** - Create migrations for 4 tables
3. ⏳ **Laravel setup** - Generate master seeds (one-time)
4. ⏳ **Laravel services** - Implement:
   - WalletAddressService (generate addresses)
   - DepositListenerService (detect deposits)
   - SweepService (consolidate to hot wallet)
   - WithdrawalService (send from hot wallet)

### Future Enhancements:

- Cold wallet integration (80% of funds offline)
- Withdrawal approval workflow (for large amounts)
- Fee optimization (dynamic gas prices)
- Multi-signature hot wallet
- Webhook retry logic
- Real-time balance reconciliation

---

## Security Checklist

- ✅ Mnemonics encrypted in Laravel database (Crypt::encrypt)
- ✅ Private keys never stored (derived on-demand from mnemonic)
- ✅ Wallet service is stateless (no persistence)
- ✅ Hot wallet has limited funds (5-10% of total)
- ⏳ Add HMAC authentication between Laravel ↔ Wallet service
- ⏳ Add IP whitelisting for wallet service
- ⏳ Add rate limiting on withdrawal endpoints
- ⏳ Implement cold wallet for 80% of funds

---

## Questions?

**Q: Where are private keys stored?**
A: Nowhere. They are derived on-demand from master mnemonic + index, used to sign transaction, then immediately discarded.

**Q: What if wallet service goes down?**
A: Users can still see balances, trade, etc. (Laravel has all data). You just can't generate new addresses or process withdrawals until it's back up.

**Q: How does Laravel call wallet service?**
A: HTTP requests using `Illuminate\Support\Facades\Http::get()` or `Http::post()`

**Q: Can I run wallet service in Docker?**
A: Yes, uncomment the `wallet-api` service in `docker-compose.yml`

---

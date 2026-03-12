# Sweep & Withdrawal Services

## Overview

Both services work similarly:
1. **Sweep**: Transfer funds from user deposit address → hot wallet
2. **Withdrawal**: Transfer funds from hot wallet → external address (user's personal wallet)

---

## Architecture Decision: Who Signs Transactions?

### Option A: Laravel Signs (Laravel has private keys)
```
Laravel:
├─ Has database with addresses
├─ Stores private keys (encrypted)
├─ Signs transactions using PHP libraries
└─ Broadcasts to blockchain
```

### Option B: Wallet Microservice Signs (RECOMMENDED)
```
Laravel:
├─ Has database, doesn't store private keys
├─ Calls wallet service with: mnemonic + index + transaction details
  ↓
Wallet Service:
├─ Derives private key from mnemonic + index
├─ Signs transaction
├─ Returns signed transaction
  ↓
Laravel:
└─ Broadcasts signed transaction to blockchain
```

**Recommendation: Option B** - Keep private key operations in wallet service (separation of concerns)

---

## Implementation

###  Add Transaction Signing Endpoints to Wallet Service

Add these to your `wallets.controller.ts`:

```typescript
// ==================== TRANSACTION SIGNING ====================

/**
 * Sign Tron transaction
 * POST /api/wallets/tron/sign-transaction
 *
 * Body: {
 *   mnemonic: string,
 *   index: number,
 *   to: string,
 *   amount: number,
 *   token?: string (optional, for TRC20)
 * }
 */
@Post('tron/sign-transaction')
async signTronTransaction(@Body() body: any) {
  const { mnemonic, index, to, amount, token } = body;

  // 1. Validate mnemonic
  if (!this.tronWalletService.validateMnemonic(mnemonic)) {
    return { error: 'Invalid mnemonic' };
  }

  // 2. Derive private key
  const wallet = this.tronWalletService.deriveAddress(mnemonic, index);

  // 3. Sign transaction
  const signedTx = await this.tronWalletService.signTransaction({
    privateKey: wallet.privateKey,
    to: to,
    amount: amount,
    token: token, // undefined for TRX, contract address for USDT
  });

  return {
    signedTransaction: signedTx,
    from: wallet.address,
    to: to,
    amount: amount,
    note: 'Broadcast this transaction to the blockchain',
  };
}

// Similar endpoints for ethereum/bitcoin/solana...
```

### Add Signing Logic to Wallet Services

Example for Tron:

```typescript
// In tron-wallet.service.ts

async signTransaction(params: {
  privateKey: string;
  to: string;
  amount: number;
  token?: string;
}): Promise<string> {
  const TronWeb = require('tronweb');

  const tronWeb = new TronWeb({
    fullHost: 'https://api.trongrid.io',
    privateKey: params.privateKey,
  });

  let transaction;

  if (params.token) {
    // TRC20 token transfer (e.g., USDT)
    const contract = await tronWeb.contract().at(params.token);
    transaction = await contract.transfer(
      params.to,
      params.amount * 1e6 // Convert to smallest unit
    ).send();
  } else {
    // Native TRX transfer
    transaction = await tronWeb.transactionBuilder.sendTrx(
      params.to,
      params.amount * 1e6, // Convert to SUN
      tronWeb.defaultAddress.base58
    );

    const signedTx = await tronWeb.trx.sign(transaction);
    return signedTx;
  }

  return transaction;
}
```

---

## Laravel Implementation

### Sweep Service

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Crypt;

class SweepService
{
    private $walletServiceUrl = 'http://localhost:3000/api/wallets';
    private $hotWallets = [
        'tron' => 'THotWallet123...', // Your exchange's hot wallet address
        'ethereum' => '0xHotWallet123...',
        'bitcoin' => 'bc1qHotWallet123...',
        'solana' => 'HotWallet123...',
    ];

    /**
     * Sweep all confirmed deposits to hot wallet
     * Run this every 2-4 hours via cron job
     */
    public function sweepAllDeposits(string $network)
    {
        // 1. Get all addresses with unswepted confirmed deposits
        $addressesWithFunds = DB::table('transactions as t')
            ->join('wallet_addresses as wa', function($join) use ($network) {
                $join->on('t.user_id', '=', 'wa.user_id')
                     ->where('wa.network', $network);
            })
            ->where('t.network', $network)
            ->where('t.type', 'deposit')
            ->where('t.status', 'confirmed')
            ->where('t.swept', false)
            ->select(
                'wa.address',
                'wa.derivation_index',
                'wa.user_id',
                't.coin_symbol',
                DB::raw('SUM(t.amount) as total_amount'),
                DB::raw('array_agg(t.id) as transaction_ids')
            )
            ->groupBy('wa.address', 'wa.derivation_index', 'wa.user_id', 't.coin_symbol')
            ->having(DB::raw('SUM(t.amount)'), '>', 0)
            ->get();

        foreach ($addressesWithFunds as $addr) {
            try {
                $this->sweepAddress($addr, $network);
            } catch (\Exception $e) {
                \Log::error("Sweep failed for {$addr->address}: " . $e->getMessage());
                // Continue with other addresses
            }
        }
    }

    private function sweepAddress($addressData, $network)
    {
        // 1. Get master seed
        $masterSeed = DB::table('master_seeds')
            ->where('network', $network)
            ->first();

        $mnemonic = Crypt::decryptString($masterSeed->encrypted_mnemonic);

        // 2. Call wallet service to sign sweep transaction
        $response = Http::post("{$this->walletServiceUrl}/{$network}/sign-transaction", [
            'mnemonic' => $mnemonic,
            'index' => $addressData->derivation_index,
            'to' => $this->hotWallets[$network],
            'amount' => $addressData->total_amount,
            'token' => $addressData->coin_symbol !== strtoupper($network)
                ? $this->getTokenContract($network, $addressData->coin_symbol)
                : null,
        ]);

        if (!$response->successful()) {
            throw new \Exception("Failed to sign sweep transaction");
        }

        $signedTx = $response->json()['signedTransaction'];

        // 3. Broadcast transaction to blockchain
        $txHash = $this->broadcastTransaction($network, $signedTx);

        // 4. Mark deposits as swept
        DB::table('transactions')
            ->whereIn('id', $addressData->transaction_ids)
            ->update([
                'swept' => true,
                'swept_at' => now(),
                'sweep_tx_hash' => $txHash,
            ]);

        \Log::info("✅ Swept {$addressData->total_amount} {$addressData->coin_symbol} to hot wallet: {$txHash}");

        return $txHash;
    }

    private function broadcastTransaction(string $network, string $signedTx)
    {
        // Broadcast to blockchain RPC
        switch ($network) {
            case 'tron':
                return $this->broadcastTronTransaction($signedTx);
            case 'ethereum':
                return $this->broadcastEthereumTransaction($signedTx);
            case 'bitcoin':
                return $this->broadcastBitcoinTransaction($signedTx);
            case 'solana':
                return $this->broadcastSolanaTransaction($signedTx);
        }
    }

    private function broadcastTronTransaction(string $signedTx)
    {
        $response = Http::post('https://api.trongrid.io/wallet/broadcasttransaction', [
            'transaction' => json_decode($signedTx),
        ]);

        return $response->json()['txid'];
    }

    private function getTokenContract(string $network, string $symbol)
    {
        // Map of token symbols to contract addresses
        $contracts = [
            'tron' => [
                'USDT' => 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
                'USDC' => 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8',
            ],
            'ethereum' => [
                'USDT' => '0xdac17f958d2ee523a2206206994597c13d831ec7',
                'USDC' => '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            ],
        ];

        return $contracts[$network][$symbol] ?? null;
    }
}
```

### Withdrawal Service

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Crypt;

class WithdrawalService
{
    private $walletServiceUrl = 'http://localhost:3000/api/wallets';
    private $hotWalletIndexes = [
        'tron' => 0, // Hot wallet is at index 0 of master seed
        'ethereum' => 0,
        'bitcoin' => 0,
        'solana' => 0,
    ];

    /**
     * Process user withdrawal request
     */
    public function processWithdrawal(int $userId, string $network, string $coin, float $amount, string $toAddress)
    {
        // 1. Validate user has sufficient balance
        $balance = DB::table('wallet_balances')
            ->where('user_id', $userId)
            ->where('network', $network)
            ->where('coin_symbol', $coin)
            ->lockForUpdate()
            ->first();

        if (!$balance || $balance->available < $amount) {
            throw new \Exception("Insufficient balance");
        }

        // 2. Validate withdrawal address
        if (!$this->validateAddress($network, $toAddress)) {
            throw new \Exception("Invalid withdrawal address");
        }

        // 3. Lock user's balance
        DB::table('wallet_balances')
            ->where('id', $balance->id)
            ->update([
                'available' => DB::raw("available - {$amount}"),
                'locked' => DB::raw("locked + {$amount}"),
            ]);

        // 4. Create withdrawal transaction record
        $transactionId = DB::table('transactions')->insertGetId([
            'user_id' => $userId,
            'network' => $network,
            'coin_symbol' => $coin,
            'type' => 'withdrawal',
            'amount' => $amount,
            'fee' => $this->calculateFee($network, $coin), // TODO: Implement fee logic
            'from_address' => $this->getHotWalletAddress($network),
            'to_address' => $toAddress,
            'status' => 'pending',
            'confirmations' => 0,
            'required_confirmations' => $this->getRequiredConfirmations($network),
            'idempotency_key' => uniqid('withdraw_', true),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        try {
            // 5. Sign and broadcast transaction
            $txHash = $this->signAndBroadcast($network, $coin, $amount, $toAddress);

            // 6. Update transaction with tx hash
            DB::table('transactions')
                ->where('id', $transactionId)
                ->update([
                    'tx_hash' => $txHash,
                    'status' => 'broadcasted',
                ]);

            // 7. Deduct from locked balance
            DB::table('wallet_balances')
                ->where('id', $balance->id)
                ->update([
                    'locked' => DB::raw("locked - {$amount}"),
                    'balance' => DB::raw("balance - {$amount}"),
                    'total_withdrawn' => DB::raw("total_withdrawn + {$amount}"),
                ]);

            return [
                'success' => true,
                'transaction_id' => $transactionId,
                'tx_hash' => $txHash,
                'amount' => $amount,
                'to_address' => $toAddress,
            ];

        } catch (\Exception $e) {
            // Rollback: Unlock balance
            DB::table('wallet_balances')
                ->where('id', $balance->id)
                ->update([
                    'available' => DB::raw("available + {$amount}"),
                    'locked' => DB::raw("locked - {$amount}"),
                ]);

            DB::table('transactions')
                ->where('id', $transactionId)
                ->update([
                    'status' => 'failed',
                    'error_message' => $e->getMessage(),
                ]);

            throw $e;
        }
    }

    private function signAndBroadcast($network, $coin, $amount, $toAddress)
    {
        // 1. Get master seed for hot wallet
        $masterSeed = DB::table('master_seeds')
            ->where('network', $network)
            ->first();

        $mnemonic = Crypt::decryptString($masterSeed->encrypted_mnemonic);

        // 2. Call wallet service to sign transaction from hot wallet
        $response = Http::post("{$this->walletServiceUrl}/{$network}/sign-transaction", [
            'mnemonic' => $mnemonic,
            'index' => $this->hotWalletIndexes[$network], // Hot wallet index
            'to' => $toAddress,
            'amount' => $amount,
            'token' => $coin !== strtoupper($network)
                ? $this->getTokenContract($network, $coin)
                : null,
        ]);

        if (!$response->successful()) {
            throw new \Exception("Failed to sign withdrawal transaction");
        }

        $signedTx = $response->json()['signedTransaction'];

        // 3. Broadcast to blockchain
        return $this->broadcastTransaction($network, $signedTx);
    }

    private function validateAddress($network, $address)
    {
        $response = Http::get("{$this->walletServiceUrl}/{$network}/validate", [
            'address' => $address,
        ]);

        return $response->json()['isValid'] ?? false;
    }

    private function getHotWalletAddress($network)
    {
        // Get hot wallet address from database
        $masterSeed = DB::table('master_seeds')
            ->where('network', $network)
            ->first();

        $mnemonic = Crypt::decryptString($masterSeed->encrypted_mnemonic);

        // Derive hot wallet address (index 0)
        $response = Http::get("{$this->walletServiceUrl}/{$network}/derive", [
            'mnemonic' => $mnemonic,
            'index' => 0,
        ]);

        return $response->json()['address'];
    }

    private function calculateFee($network, $coin)
    {
        // TODO: Implement dynamic fee calculation based on network congestion
        $fees = [
            'tron' => 1, // 1 TRX
            'ethereum' => 0.001, // 0.001 ETH
            'bitcoin' => 0.0001, // 0.0001 BTC
            'solana' => 0.000005, // 0.000005 SOL
        ];

        return $fees[$network] ?? 0;
    }

    private function getRequiredConfirmations($network)
    {
        return [
            'tron' => 19,
            'ethereum' => 12,
            'bitcoin' => 3,
            'solana' => 32,
        ][$network];
    }

    // Reuse broadcast methods from SweepService...
}
```

---

## Cron Jobs to Run

Add to Laravel `app/Console/Kernel.php`:

```php
protected function schedule(Schedule $schedule)
{
    // Run sweep service every 2 hours
    $schedule->call(function () {
        app(SweepService::class)->sweepAllDeposits('tron');
        app(SweepService::class)->sweepAllDeposits('ethereum');
        app(SweepService::class)->sweepAllDeposits('bitcoin');
        app(SweepService::class)->sweepAllDeposits('solana');
    })->everyTwoHours();

    // Monitor deposit confirmations every minute
    $schedule->command('wallet:confirm-deposits')->everyMinute();
}
```

---

## Summary

### Complete Flow:

**Deposit:**
1. Laravel listener detects deposit
2. Stores in transactions (pending)
3. Waits for confirmations
4. Credits balance when confirmed
5. Sweep service consolidates to hot wallet

**Withdrawal:**
1. User requests withdrawal
2. Lock balance
3. Call wallet service to sign transaction from hot wallet
4. Broadcast to blockchain
5. Deduct from balance
6. Monitor confirmations

### Who Does What:

| Task | Laravel | Wallet Service |
|------|---------|----------------|
| Detect deposits | ✅ Listener | OR webhook |
| Store transactions | ✅ Database | ❌ |
| Credit balances | ✅ Database | ❌ |
| Derive addresses | Calls API → | ✅ Returns address |
| Sign sweep tx | Calls API → | ✅ Signs & returns |
| Sign withdrawal tx | Calls API → | ✅ Signs & returns |
| Broadcast tx | ✅ To blockchain | ❌ |

**Wallet service = Pure crypto operations (stateless)**
**Laravel = Everything else (database, business logic)**

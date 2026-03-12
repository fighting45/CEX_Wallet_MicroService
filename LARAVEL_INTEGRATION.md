# Laravel Integration Guide - Stateless Wallet Microservice

## Architecture Overview

```
┌─────────────────────────────────────────┐
│      Laravel Backend (Exchange)         │
│  - Has Database (PostgreSQL/MySQL)      │
│  - Stores master seeds (encrypted)      │
│  - Stores user addresses                │
│  - Stores balances                      │
│  - Runs blockchain listeners            │
│  - Handles sweep operations             │
└──────────────┬──────────────────────────┘
               │ HTTP API Calls
               ↓
┌──────────────────────────────────────────┐
│    Node.js Wallet Microservice           │
│  - NO Database (Stateless)               │
│  - Performs crypto operations only       │
│  - Generates mnemonics                   │
│  - Derives addresses                     │
│  - Signs transactions (future)           │
└──────────────────────────────────────────┘
```

---

## What Changed

### ❌ Removed from Wallet Service:
- PostgreSQL database
- TypeORM entities (master_seeds, wallet_addresses, wallet_balances, transactions)
- Database configuration
- All persistence logic

### ✅ What Remains in Wallet Service:
- HD wallet generation services (Tron, Ethereum, Bitcoin, Solana)
- Mnemonic generation
- Address derivation from mnemonic + index
- Address validation
- Encryption service (optional, Laravel can use its own)

### ✅ What Laravel Now Handles:
- **ALL database operations**
- Master seed storage (encrypted)
- User address mapping
- Balance tracking
- Transaction history
- Blockchain listeners (deposit detection)
- Sweep operations

---

## Laravel Database Schema

Create these tables in your Laravel database:

### 1. `master_seeds` Table

```php
Schema::create('master_seeds', function (Blueprint $table) {
    $table->id();
    $table->string('network', 20)->unique(); // tron, ethereum, bitcoin, solana
    $table->text('encrypted_mnemonic'); // AES-256 encrypted
    $table->integer('next_index')->default(0); // Next index to assign to new user
    $table->string('derivation_path_template', 100);
    $table->string('wallet_tier', 20)->default('hot'); // hot, warm, cold
    $table->boolean('is_active')->default(true);
    $table->timestamps();
});
```

### 2. `wallet_addresses` Table

```php
Schema::create('wallet_addresses', function (Blueprint $table) {
    $table->id();
    $table->unsignedBigInteger('user_id');
    $table->string('network', 20); // tron, ethereum, bitcoin, solana
    $table->string('address', 100)->unique();
    $table->integer('derivation_index');
    $table->string('derivation_path', 100);
    $table->string('address_type', 20)->default('hd'); // hd or legacy
    $table->string('address_format', 20)->nullable(); // For Bitcoin: native-segwit or legacy
    $table->decimal('total_received', 36, 18)->default(0);
    $table->boolean('is_active')->default(true);
    $table->timestamp('last_deposit_at')->nullable();
    $table->timestamps();

    $table->unique(['user_id', 'network']); // One address per user per network
    $table->index('address'); // Fast lookups for deposit detection
    $table->foreign('user_id')->references('id')->on('users');
});
```

### 3. `wallet_balances` Table

```php
Schema::create('wallet_balances', function (Blueprint $table) {
    $table->id();
    $table->unsignedBigInteger('user_id');
    $table->string('network', 20);
    $table->string('coin_symbol', 20); // TRX, USDT, ETH, BTC, SOL
    $table->decimal('balance', 36, 18)->default(0);
    $table->decimal('available', 36, 18)->default(0);
    $table->decimal('locked', 36, 18)->default(0);
    $table->decimal('total_deposited', 36, 18)->default(0);
    $table->decimal('total_withdrawn', 36, 18)->default(0);
    $table->timestamp('last_reconciled_at')->nullable();
    $table->timestamps();

    $table->unique(['user_id', 'network', 'coin_symbol']);
    $table->index('user_id');
    $table->foreign('user_id')->references('id')->on('users');
});
```

### 4. `transactions` Table

```php
Schema::create('transactions', function (Blueprint $table) {
    $table->id();
    $table->unsignedBigInteger('user_id');
    $table->string('network', 20);
    $table->string('coin_symbol', 20);
    $table->enum('type', ['deposit', 'withdrawal']);
    $table->decimal('amount', 36, 18);
    $table->decimal('fee', 36, 18)->default(0);
    $table->string('from_address', 100);
    $table->string('to_address', 100);
    $table->string('tx_hash', 255)->unique()->nullable();
    $table->string('status', 20); // pending, confirmed, failed, swept
    $table->integer('confirmations')->default(0);
    $table->integer('required_confirmations');
    $table->boolean('swept')->default(false);
    $table->timestamp('swept_at')->nullable();
    $table->string('sweep_tx_hash', 255)->nullable();
    $table->string('idempotency_key', 100)->nullable();
    $table->text('error_message')->nullable();
    $table->json('metadata')->nullable();
    $table->timestamp('confirmed_at')->nullable();
    $table->timestamps();

    $table->index('user_id');
    $table->index('tx_hash');
    $table->index(['network', 'status']);
    $table->index(['type', 'status']);
    $table->foreign('user_id')->references('id')->on('users');
});
```

---

## Laravel Implementation

### Step 1: Initial Setup - Generate Master Seeds

Run this ONCE per network to create master mnemonics:

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Crypt;

class WalletSetupService
{
    private $walletServiceUrl = 'http://localhost:3000/api/wallets';

    /**
     * Generate and store master seed for a network
     * Run this ONCE per network
     */
    public function generateMasterSeed(string $network)
    {
        // 1. Call wallet service to generate mnemonic
        $response = Http::get("{$this->walletServiceUrl}/{$network}/generate");

        if (!$response->successful()) {
            throw new \Exception("Failed to generate {$network} mnemonic");
        }

        $data = $response->json();
        $mnemonic = $data['mnemonic'];
        $derivationPathTemplate = $data['derivationPathTemplate'] ?? $data['derivationPaths'] ?? null;

        // 2. Encrypt mnemonic using Laravel's encryption
        $encryptedMnemonic = Crypt::encryptString($mnemonic);

        // 3. Store in database
        DB::table('master_seeds')->insert([
            'network' => $network,
            'encrypted_mnemonic' => $encryptedMnemonic,
            'next_index' => 0,
            'derivation_path_template' => is_array($derivationPathTemplate)
                ? json_encode($derivationPathTemplate)
                : $derivationPathTemplate,
            'wallet_tier' => 'hot',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return "Master seed for {$network} created successfully";
    }

    /**
     * Setup all networks
     */
    public function setupAllNetworks()
    {
        $networks = ['tron', 'ethereum', 'bitcoin', 'solana'];

        foreach ($networks as $network) {
            $this->generateMasterSeed($network);
        }

        return "All master seeds created";
    }
}
```

### Step 2: Generate Deposit Address for User

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Crypt;

class WalletAddressService
{
    private $walletServiceUrl = 'http://localhost:3000/api/wallets';

    /**
     * Get or create deposit address for user
     */
    public function getDepositAddress(int $userId, string $network, string $addressType = 'native-segwit')
    {
        // 1. Check if user already has address
        $existingAddress = DB::table('wallet_addresses')
            ->where('user_id', $userId)
            ->where('network', $network)
            ->first();

        if ($existingAddress) {
            return $existingAddress->address;
        }

        // 2. User doesn't have address, create new one
        return $this->createNewAddress($userId, $network, $addressType);
    }

    private function createNewAddress(int $userId, string $network, string $addressType = 'native-segwit')
    {
        // 1. Get master seed and next index
        $masterSeed = DB::table('master_seeds')
            ->where('network', $network)
            ->where('is_active', true)
            ->lockForUpdate() // Lock row to prevent race conditions
            ->first();

        if (!$masterSeed) {
            throw new \Exception("No master seed found for {$network}");
        }

        // 2. Decrypt mnemonic
        $mnemonic = Crypt::decryptString($masterSeed->encrypted_mnemonic);
        $index = $masterSeed->next_index;

        // 3. Call wallet service to derive address
        $params = [
            'mnemonic' => $mnemonic,
            'index' => $index,
        ];

        // For Bitcoin, add address type
        if ($network === 'bitcoin') {
            $params['type'] = $addressType;
        }

        $response = Http::get("{$this->walletServiceUrl}/{$network}/derive", $params);

        if (!$response->successful()) {
            throw new \Exception("Failed to derive {$network} address");
        }

        $data = $response->json();

        // 4. Store address in database
        DB::table('wallet_addresses')->insert([
            'user_id' => $userId,
            'network' => $network,
            'address' => $data['address'],
            'derivation_index' => $index,
            'derivation_path' => $data['derivationPath'],
            'address_type' => 'hd',
            'address_format' => $data['addressFormat'] ?? null,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // 5. Increment next_index
        DB::table('master_seeds')
            ->where('id', $masterSeed->id)
            ->increment('next_index');

        return $data['address'];
    }
}
```

### Step 3: Blockchain Listener (Deposit Detection)

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

class TronDepositListener extends Command
{
    protected $signature = 'wallet:listen-tron';
    protected $description = 'Monitor Tron blockchain for deposits';

    public function handle()
    {
        $this->info('Starting Tron deposit listener...');

        while (true) {
            try {
                $this->checkDeposits();
                sleep(30); // Check every 30 seconds
            } catch (\Exception $e) {
                $this->error("Error: " . $e->getMessage());
                sleep(60); // Wait longer on error
            }
        }
    }

    private function checkDeposits()
    {
        // 1. Get all Tron addresses we're monitoring
        $addresses = DB::table('wallet_addresses')
            ->where('network', 'tron')
            ->where('is_active', true)
            ->get();

        foreach ($addresses as $addr) {
            // 2. Check blockchain for transactions to this address
            $transactions = $this->getTronTransactions($addr->address);

            foreach ($transactions as $tx) {
                // 3. Check if we've already processed this transaction
                $exists = DB::table('transactions')
                    ->where('tx_hash', $tx['hash'])
                    ->exists();

                if (!$exists) {
                    // 4. New deposit detected!
                    $this->processDeposit($tx, $addr->user_id);
                } else {
                    // 5. Update confirmations
                    $this->updateConfirmations($tx['hash'], $tx['confirmations']);
                }
            }
        }
    }

    private function processDeposit($tx, $userId)
    {
        $confirmations = $tx['confirmations'];
        $requiredConfirmations = 19; // Tron requires 19

        // 1. Insert transaction as pending
        $transactionId = DB::table('transactions')->insertGetId([
            'user_id' => $userId,
            'network' => 'tron',
            'coin_symbol' => $tx['token'] ?? 'TRX',
            'type' => 'deposit',
            'amount' => $tx['amount'],
            'fee' => 0,
            'from_address' => $tx['from'],
            'to_address' => $tx['to'],
            'tx_hash' => $tx['hash'],
            'status' => $confirmations >= $requiredConfirmations ? 'confirmed' : 'pending',
            'confirmations' => $confirmations,
            'required_confirmations' => $requiredConfirmations,
            'swept' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // 2. If confirmed, credit user balance
        if ($confirmations >= $requiredConfirmations) {
            $this->creditUserBalance($userId, 'tron', $tx['token'] ?? 'TRX', $tx['amount']);

            // 3. Update transaction status
            DB::table('transactions')
                ->where('id', $transactionId)
                ->update([
                    'status' => 'confirmed',
                    'confirmed_at' => now(),
                ]);

            $this->info("✅ Credited {$tx['amount']} {$tx['token']} to user {$userId}");
        }
    }

    private function creditUserBalance($userId, $network, $coin, $amount)
    {
        // Upsert balance
        DB::table('wallet_balances')->updateOrInsert(
            [
                'user_id' => $userId,
                'network' => $network,
                'coin_symbol' => $coin,
            ],
            [
                'balance' => DB::raw("balance + {$amount}"),
                'available' => DB::raw("available + {$amount}"),
                'total_deposited' => DB::raw("total_deposited + {$amount}"),
                'updated_at' => now(),
            ]
        );
    }

    private function getTronTransactions($address)
    {
        // Use TronGrid API or your preferred RPC
        $response = Http::get("https://api.trongrid.io/v1/accounts/{$address}/transactions");
        // Parse and return transactions
        // ... implementation details
    }
}
```

### Step 4: Controller for User-Facing API

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Services\WalletAddressService;
use Illuminate\Support\Facades\DB;

class WalletController extends Controller
{
    private $walletService;

    public function __construct(WalletAddressService $walletService)
    {
        $this->walletService = $walletService;
    }

    /**
     * Get deposit address for user
     * GET /api/user/wallet/deposit-address
     */
    public function getDepositAddress(Request $request)
    {
        $request->validate([
            'coin' => 'required|string',
            'network' => 'required|string|in:tron,ethereum,bitcoin,solana',
        ]);

        $userId = auth()->id();
        $network = $request->network;

        $address = $this->walletService->getDepositAddress($userId, $network);

        return response()->json([
            'network' => $network,
            'coin' => $request->coin,
            'address' => $address,
            'note' => 'Send only ' . strtoupper($request->coin) . ' to this address on ' . ucfirst($network) . ' network',
        ]);
    }

    /**
     * Get user balances
     * GET /api/user/wallet/balances
     */
    public function getBalances()
    {
        $userId = auth()->id();

        $balances = DB::table('wallet_balances')
            ->where('user_id', $userId)
            ->get()
            ->map(function($balance) {
                return [
                    'network' => $balance->network,
                    'coin' => $balance->coin_symbol,
                    'balance' => $balance->balance,
                    'available' => $balance->available,
                    'locked' => $balance->locked,
                ];
            });

        return response()->json(['balances' => $balances]);
    }

    /**
     * Get transaction history
     * GET /api/user/wallet/transactions
     */
    public function getTransactions(Request $request)
    {
        $userId = auth()->id();

        $transactions = DB::table('transactions')
            ->where('user_id', $userId)
            ->orderBy('created_at', 'desc')
            ->limit(50)
            ->get();

        return response()->json(['transactions' => $transactions]);
    }
}
```

---

## Summary

### Wallet Microservice APIs (Available Now):

| Endpoint | Purpose | Laravel Uses When |
|----------|---------|------------------|
| `GET /wallets/{network}/generate` | Generate master mnemonic | Initial setup (once per network) |
| `GET /wallets/{network}/derive` | Derive address from mnemonic | User requests deposit address |
| `GET /wallets/{network}/validate` | Validate address format | Before sending withdrawals |

### What Laravel Handles:

1. **Database**: All persistence (seeds, addresses, balances, transactions)
2. **Listeners**: Blockchain monitoring for deposits
3. **Sweep**: Consolidate funds from user addresses to hot wallet
4. **User API**: Endpoints for users to get addresses, balances, withdraw, etc.
5. **Business Logic**: Trading, fee calculation, limits, etc.

### Next Steps:

1. Create Laravel migrations for the 4 tables
2. Run `WalletSetupService::setupAllNetworks()` to generate master seeds
3. Implement `WalletAddressService` for address generation
4. Implement blockchain listeners for each network
5. Implement sweep service (consolidate deposits to hot wallet)
6. Add withdrawal endpoints (sign + broadcast using wallet service)

**Wallet microservice is now ready and stateless!** Laravel calls it only for cryptographic operations.

Exbotix Custodial Wallet Service - Implementation Plan

Overview

Build a Node.js microservice (NestJS) for custodial wallet management that
integrates with existing Laravel exchange backend via REST API. Supports
Bitcoin, Ethereum/EVM chains, Tron, and Solana with HD wallet architecture.

Architecture Decisions

Technology Stack

- Framework: NestJS (TypeScript) - microservices pattern, DI, better
  maintainability
- Database: PostgreSQL - ACID compliance critical for financial data
- Cache/Queue: Redis - balance caching, Bull queue for async transactions
- ORM: TypeORM - native NestJS integration
- Blockchain Libraries:
  - Bitcoin: bitcoinjs-lib + bip32 + bip39
  - Ethereum/EVM: ethers.js v6
  - Tron: tronweb
  - Solana: @solana/web3.js + @solana/spl-token

Integration Model

Laravel Exchange ←→ (REST API + HMAC Auth) ←→ Node.js Wallet Service ←→
Blockchains

Service Architecture

Docker Containers:
├── wallet-api (NestJS main service)
├── postgres (wallet data, transactions)
├── redis (cache, queue)
├── listener-bitcoin (deposit monitoring)
├── listener-ethereum (deposit monitoring)
├── listener-tron (deposit monitoring)
├── listener-solana (deposit monitoring)
└── worker (withdrawal transaction processor)

Database Schema (Key Tables)

master_seeds

- Encrypted master seed per blockchain (AES-256-GCM)
- Derivation path and next index tracker
- Wallet tier (hot/warm/cold)

wallet_addresses

- User ID → blockchain address mappings
- Derivation index per address
- Total received tracking

wallet_balances

- User balances per blockchain/currency
- Available, pending, locked balances
- Reconciliation tracking

transactions

- All deposits and withdrawals
- Status tracking (pending → processing → confirmed)
- Confirmation count, tx hash, fees
- Idempotency key for duplicate prevention

blockchain_state

- Last processed block per chain
- Listener status and sync state

Core Features

1.  HD Wallet System

- Master Seed: Single encrypted seed per blockchain
- Address Derivation:
  - Bitcoin: m/44'/0'/0'/0/{index}
  - Ethereum: m/44'/60'/0'/0/{index}
  - Tron: Same as Ethereum (converted)
  - Solana: m/44'/501'/0'/{index}'
- Encryption: AES-256-GCM with env-based key + salt
- Security: Private keys only in memory during signing, immediately cleared

2.  Deposit Detection (Blockchain Listeners)

- Ethereum: WebSocket subscriptions for real-time detection
- Bitcoin: Block polling + UTXO tracking
- Tron: HTTP polling for events
- Solana: Account subscriptions
- Flow: Detect TX → Pending → N confirmations → Confirmed → Credit balance →
  Webhook to Laravel

3.  Withdrawal Processing

- Queue-based: Bull queue with priority and retry logic
- Flow: Validate → Lock balance → Queue → Sign → Broadcast → Monitor → Confirm
  → Unlock
- Security:
  - Idempotency keys prevent duplicates
  - Address validation and blacklist checking
  - Hot wallet limits with warm/cold wallet tiers

4.  Laravel Integration

- Authentication: HMAC-SHA256 request signing with shared secret
- APIs Exposed:
  - POST /api/wallets/address - Generate deposit address
  - GET /api/wallets/balance/:user_id - Get balances
  - POST /api/transactions/withdraw - Request withdrawal
  - GET /api/transactions/:id - Get transaction status
  - GET /api/transactions/history/:user_id - Transaction history
- Webhooks to Laravel:
  - Deposit confirmations
  - Withdrawal status updates

5.  Security Model

Hot/Warm/Cold Wallets:

- Hot (5%): Automated withdrawals, encrypted with env key
- Warm (15%): Large withdrawals, requires approval, time-delayed
- Cold (80%): Offline storage, manual process

Additional Security:

- Request signature validation (prevent tampering)
- Timestamp validation (prevent replay attacks)
- Rate limiting per API key
- IP whitelisting
- Withdrawal velocity limits
- Audit logging for all key operations

Implementation Phases

Phase 1: Foundation (Week 1-2)

Goal: Project setup and database

Tasks:

1.  Initialize NestJS project with TypeScript
2.  Docker Compose setup (PostgreSQL + Redis)
3.  TypeORM configuration and migrations
4.  Core modules: Auth, Config, Database, Logger
5.  Health check endpoint
6.  API signature authentication guard

Key Files:

- /src/main.ts
- /src/app.module.ts
- /src/modules/auth/guards/api-signature.guard.ts
- /src/config/database.config.ts
- /database/migrations/001-initial-schema.ts
- /docker-compose.yml
- /.env.example

---

Phase 2: HD Wallet System (Week 3-4)

Goal: Wallet generation for all blockchains

Tasks:

1.  Encryption service (AES-256-GCM for master seeds)
2.  HD wallet services (Bitcoin, Ethereum, Tron, Solana)
3.  Address generation and derivation logic
4.  Wallet management APIs
5.  Database integration for addresses and balances

Key Files:

- /src/modules/encryption/encryption.service.ts
- /src/modules/wallets/wallet.service.ts
- /src/modules/blockchain/bitcoin/bitcoin-wallet.service.ts
- /src/modules/blockchain/ethereum/ethereum-wallet.service.ts
- /src/modules/blockchain/tron/tron-wallet.service.ts
- /src/modules/blockchain/solana/solana-wallet.service.ts
- /src/modules/wallets/wallet.controller.ts

Testing: Generate addresses on all testnets, verify derivation paths, validate
formats

---

Phase 3: Blockchain Listeners (Week 5-6)

Goal: Automated deposit detection

Tasks:

1.  Abstract base listener class with common logic
2.  Implement listeners for each blockchain:

- Bitcoin: Block polling, UTXO detection
- Ethereum: WebSocket events, ERC20 transfers
- Tron: Event polling, TRC20 transfers
- Solana: Account subscriptions, SPL tokens

3.  Deposit processing pipeline (pending → confirmed)
4.  Balance updates and webhook callbacks to Laravel
5.  State management (last processed block)

Key Files:

- /src/modules/listeners/base-listener.ts
- /src/modules/listeners/bitcoin-listener.service.ts
- /src/modules/listeners/ethereum-listener.service.ts
- /src/modules/listeners/tron-listener.service.ts
- /src/modules/listeners/solana-listener.service.ts
- /src/modules/transactions/deposit-processor.service.ts

Testing: Send testnet deposits, verify detection and confirmation tracking

---

Phase 4: Withdrawal Processing (Week 7-8)

Goal: Secure withdrawal system

Tasks:

1.  Transaction service with validation and balance locking
2.  Bull queue setup for withdrawal processing
3.  Transaction signing for each blockchain:

- Bitcoin: UTXO selection, fee calculation
- Ethereum: Nonce management, EIP-1559 gas
- Tron: Energy/bandwidth estimation
- Solana: Recent blockhash, transaction construction

4.  Broadcasting with fallback RPC providers
5.  Confirmation tracking and status updates
6.  Webhook notifications to Laravel

Key Files:

- /src/modules/transactions/transaction.service.ts
- /src/modules/transactions/transaction.controller.ts
- /src/modules/transactions/withdrawal-processor.service.ts
- /src/modules/blockchain/bitcoin/bitcoin-transaction.service.ts
- /src/modules/blockchain/ethereum/ethereum-transaction.service.ts
- /src/modules/blockchain/tron/tron-transaction.service.ts
- /src/modules/blockchain/solana/solana-transaction.service.ts
- /src/workers/transaction-worker.ts

Testing: Testnet withdrawals, idempotency, queue retries, failure scenarios

---

Phase 5: Security Hardening (Week 9)

Goal: Production-grade security

Tasks:

1.  Hot/warm/cold wallet tier implementation
2.  Withdrawal limits and approval workflows
3.  Rate limiting and IP whitelisting
4.  Address blacklist checking
5.  Velocity limits (daily/hourly)
6.  Comprehensive audit logging
7.  Monitoring and alerting setup

Key Files:

- /src/modules/wallets/wallet-tier-manager.service.ts
- /src/modules/security/withdrawal-validator.service.ts
- /src/modules/security/rate-limiter.guard.ts
- /src/modules/audit/audit-logger.service.ts
- /src/modules/monitoring/metrics.service.ts

Testing: Security testing, rate limit validation, alert triggers

---

Phase 6: Integration & Testing (Week 10)

Goal: End-to-end Laravel integration

Tasks:

1.  API documentation (Swagger/OpenAPI)
2.  Laravel SDK/client library
3.  Webhook endpoint implementation on Laravel side
4.  Comprehensive testing:

- Unit tests for all services
- Integration tests for APIs
- E2E tests (deposit → credit, withdraw → send)

5.  Performance optimization
6.  Documentation (architecture, deployment, troubleshooting)

Testing: Full integration with Laravel exchange, load testing, failure
scenarios

---

Phase 7: Production Deployment (Week 11-12)

Goal: Live production deployment

Tasks:

1.  Production infrastructure setup
2.  SSL/TLS and firewall configuration
3.  HSM integration for key storage (AWS CloudHSM/Azure Key Vault)
4.  Monitoring (Prometheus + Grafana)
5.  Log aggregation and alerting
6.  Automated backups and disaster recovery
7.  Mainnet RPC configuration
8.  Generate production master seeds
9.  Gradual rollout (staging → limited beta → full deployment)

Critical:

- Test EVERYTHING on testnet first
- 48-hour staging monitoring before production
- 24/7 monitoring during first week

---

Critical Security Checklist

- Master seeds encrypted with AES-256-GCM
- Private keys never logged or persisted unencrypted
- Request signature validation (HMAC-SHA256)
- Timestamp validation (max 5 min old)
- Idempotency keys for all withdrawals
- Hot wallet limits enforced
- Withdrawal approval workflow for large amounts
- Address format validation and blacklist checking
- Rate limiting per API key
- IP whitelisting for Laravel
- Comprehensive audit logging
- Automated balance reconciliation
- TLS 1.3 for all communication
- Secrets in environment variables, never in code
- Database backups (encrypted, automated)

Confirmation Requirements

- Bitcoin: 3 confirmations
- Ethereum: 12 confirmations
- Tron: 19 confirmations
- Solana: 32 confirmations

Project Structure

Exbotix_Wallet_Service/
├── src/
│ ├── modules/
│ │ ├── auth/ # API authentication
│ │ ├── wallets/ # Wallet management
│ │ ├── transactions/ # Transaction handling
│ │ ├── blockchain/ # Blockchain integrations
│ │ │ ├── bitcoin/
│ │ │ ├── ethereum/
│ │ │ ├── tron/
│ │ │ └── solana/
│ │ ├── listeners/ # Deposit listeners
│ │ ├── encryption/ # Key encryption
│ │ ├── security/ # Security services
│ │ └── monitoring/ # Metrics & alerts
│ ├── workers/ # Queue workers
│ ├── config/ # Configuration
│ ├── database/
│ │ ├── entities/
│ │ └── migrations/
│ └── main.ts
├── docker-compose.yml
├── Dockerfile
├── package.json
└── .env.example

Next Steps After Approval

1.  Initialize NestJS project
2.  Set up Docker development environment
3.  Create database schema and migrations
4.  Begin Phase 1 implementation
5.  Test each phase on testnet before moving forward
6.  Deploy to staging environment before production

Notes

- All development on TESTNET first
- Use separate master seeds for dev/staging/production
- Never expose private keys in logs or errors
- Maintain >80% test coverage
- Code reviews required for all PRs
- Regular security audits
- Document incident response procedures

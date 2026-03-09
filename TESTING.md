# Exbotix Wallet Service - Testing Guide

## Quick Start

### Start the Server

```bash
npm run start:dev
```

Server will run on: `http://localhost:3000`

---

## Option 1: Postman Collection (Recommended)

### Steps:

1. **Open Postman**
2. **Import Collection**:
   - Click "Import" button
   - Select file: `Exbotix_Wallet_Service.postman_collection.json`
   - Click "Import"
3. **Run Requests**:
   - Expand folders: Tron, Ethereum, Bitcoin, Solana
   - Click any request
   - Click "Send"

### What's Included:

- ✅ Health check
- ✅ 4 Tron endpoints
- ✅ 4 Ethereum endpoints
- ✅ 5 Bitcoin endpoints (Native SegWit + Legacy)
- ✅ 4 Solana endpoints

**Total: 18 pre-configured requests**

---

## Option 2: Automated Test Script

### Run All Tests:

```bash
./test-wallets.sh
```

This will automatically test all endpoints and show results.

---

## Option 3: Manual cURL Commands

### Health Check

```bash
curl http://localhost:3000/api/health | python3 -m json.tool
```

### Tron Wallets

```bash
# Generate 1 Tron address
curl "http://localhost:3000/api/wallets/tron/generate?count=1" | python3 -m json.tool

# Generate 3 Tron addresses
curl "http://localhost:3000/api/wallets/tron/generate?count=3" | python3 -m json.tool

# Derive from mnemonic
curl "http://localhost:3000/api/wallets/tron/derive?mnemonic=abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20about&index=0" | python3 -m json.tool

# Validate address
curl "http://localhost:3000/api/wallets/tron/validate?address=TYourAddress" | python3 -m json.tool
```

### Ethereum Wallets

```bash
# Generate 1 Ethereum address
curl "http://localhost:3000/api/wallets/ethereum/generate?count=1" | python3 -m json.tool

# Generate 3 Ethereum addresses
curl "http://localhost:3000/api/wallets/ethereum/generate?count=3" | python3 -m json.tool

# Derive from mnemonic
curl "http://localhost:3000/api/wallets/ethereum/derive?mnemonic=abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20about&index=0" | python3 -m json.tool

# Validate address
curl "http://localhost:3000/api/wallets/ethereum/validate?address=0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb" | python3 -m json.tool
```

### Bitcoin Wallets

```bash
# Generate Native SegWit (bc1...)
curl "http://localhost:3000/api/wallets/bitcoin/generate?count=3&type=native-segwit" | python3 -m json.tool

# Generate Legacy (1...)
curl "http://localhost:3000/api/wallets/bitcoin/generate?count=3&type=legacy" | python3 -m json.tool

# Derive from mnemonic
curl "http://localhost:3000/api/wallets/bitcoin/derive?mnemonic=abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20about&index=0&type=native-segwit" | python3 -m json.tool

# Validate address
curl "http://localhost:3000/api/wallets/bitcoin/validate?address=bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4" | python3 -m json.tool
```

### Solana Wallets

```bash
# Generate 1 Solana address
curl "http://localhost:3000/api/wallets/solana/generate?count=1" | python3 -m json.tool

# Generate 3 Solana addresses
curl "http://localhost:3000/api/wallets/solana/generate?count=3" | python3 -m json.tool

# Derive from mnemonic
curl "http://localhost:3000/api/wallets/solana/derive?mnemonic=abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20abandon%20about&index=0" | python3 -m json.tool

# Validate address
curl "http://localhost:3000/api/wallets/solana/validate?address=GgQTHtdktx1vYLPSNcxov9RLrYoWpy1YnFxERccmff9r" | python3 -m json.tool
```

---

## What to Verify

### For Each Network:

✅ **Mnemonic Generation**:
- Original mnemonic generated (12 words)
- Encrypted successfully
- Decrypted matches original
- `encryptionWorks: true`

✅ **Address Generation**:
- Addresses created for each index
- Correct format for each network:
  - Tron: Starts with `T`
  - Ethereum: Starts with `0x`
  - Bitcoin SegWit: Starts with `bc1`
  - Bitcoin Legacy: Starts with `1`
  - Solana: Base58 string

✅ **Private Keys**:
- Generated for each address
- Different for each index
- Correct format:
  - Tron: Hex string
  - Ethereum: Hex with `0x` prefix
  - Bitcoin: WIF format + hex
  - Solana: Hex string (64 bytes)

✅ **Derivation Paths**:
- Tron: `m/44'/195'/0'/0/{index}`
- Ethereum: `m/44'/60'/0'/0/{index}`
- Bitcoin SegWit: `m/84'/0'/0'/0/{index}`
- Bitcoin Legacy: `m/44'/0'/0'/0/{index}`
- Solana: `m/44'/501'/{index}'/0'`

---

## Expected Response Format

### Successful Generation:

```json
{
  "message": "Wallet generated successfully",
  "mnemonic": {
    "original": "word1 word2 ... word12",
    "encrypted": { ... },
    "decrypted": "word1 word2 ... word12",
    "encryptionWorks": true
  },
  "addresses": [
    {
      "address": "...",
      "derivationPath": "m/44'/...",
      "index": 0,
      "privateKey": "..."
    }
  ],
  "note": "SECURITY WARNING: Private keys shown for testing only..."
}
```

---

## Troubleshooting

### Server not running?
```bash
npm run start:dev
```

### Port 3000 already in use?
```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Or change port in .env file
PORT=3001
```

### Request fails?
- Check server is running: `curl http://localhost:3000/api/health`
- Check logs in terminal where server is running
- Verify endpoint URL is correct

---

## Security Note

⚠️ **WARNING**: These endpoints expose private keys for testing purposes only!

**Never use in production without**:
- Proper authentication
- Rate limiting
- IP whitelisting
- Removing private key exposure from responses
- Audit logging

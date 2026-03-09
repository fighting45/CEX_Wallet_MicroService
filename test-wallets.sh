#!/bin/bash

# Exbotix Wallet Service - Test Script
# Tests all wallet generation endpoints

BASE_URL="http://localhost:3000/api"

echo "=================================="
echo "Exbotix Wallet Service - Test Suite"
echo "=================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to test endpoint
test_endpoint() {
    local name=$1
    local url=$2

    echo -e "${BLUE}Testing: $name${NC}"
    response=$(curl -s "$url")

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Success${NC}"
        echo "$response" | python3 -m json.tool | head -20
        echo ""
    else
        echo -e "${RED}✗ Failed${NC}"
        echo ""
    fi
}

# Test Health Check
echo "1. HEALTH CHECK"
echo "----------------"
test_endpoint "Health Check" "$BASE_URL/health"

# Test Tron Wallets
echo "2. TRON WALLETS"
echo "----------------"
test_endpoint "Tron - Generate 1 Address" "$BASE_URL/wallets/tron/generate?count=1"
test_endpoint "Tron - Generate 3 Addresses" "$BASE_URL/wallets/tron/generate?count=3"

# Test Ethereum Wallets
echo "3. ETHEREUM WALLETS"
echo "-------------------"
test_endpoint "Ethereum - Generate 1 Address" "$BASE_URL/wallets/ethereum/generate?count=1"
test_endpoint "Ethereum - Generate 3 Addresses" "$BASE_URL/wallets/ethereum/generate?count=3"

# Test Bitcoin Wallets
echo "4. BITCOIN WALLETS"
echo "------------------"
test_endpoint "Bitcoin - Native SegWit (1 Address)" "$BASE_URL/wallets/bitcoin/generate?count=1&type=native-segwit"
test_endpoint "Bitcoin - Native SegWit (3 Addresses)" "$BASE_URL/wallets/bitcoin/generate?count=3&type=native-segwit"
test_endpoint "Bitcoin - Legacy (3 Addresses)" "$BASE_URL/wallets/bitcoin/generate?count=3&type=legacy"

# Test Solana Wallets
echo "5. SOLANA WALLETS"
echo "-----------------"
test_endpoint "Solana - Generate 1 Address" "$BASE_URL/wallets/solana/generate?count=1"
test_endpoint "Solana - Generate 3 Addresses" "$BASE_URL/wallets/solana/generate?count=3"

echo "=================================="
echo "Test Suite Completed!"
echo "=================================="

const fs = require('fs');
const path = require('path');

const envTemplate = `# AegisNet Protocol Environment Configuration

# -------------------------------------------------------------
# 1. NETWORK & DEPLOYMENT KEYS
# -------------------------------------------------------------
# Ethereum Sepolia RPC URL (e.g. from Alchemy, Infura, or Ankr)
SEPOLIA_RPC_URL=https://rpc.ankr.com/eth_sepolia

# Deployer Private Key (Must be funded with Sepolia ETH)
PRIVATE_KEY=0x_YOUR_PRIVATE_KEY_HERE

# Root ENS Domain Name registered on Sepolia (Default: shriyash.eth)
ENS_ROOT_NAME=shriyash.eth

# -------------------------------------------------------------
# 2. WORLD ID BIOMETRIC CREDENTIALS
# -------------------------------------------------------------
# World ID App ID (from https://developer.worldcoin.org)
WORLD_ID_APP_ID=app_staging_aegisnet_2026

# World ID Action Name
WORLD_ID_ACTION=agent-high-value-auth

# Transaction dollar threshold triggering World ID 2FA ($1,000 USD default)
BIOMETRIC_THRESHOLD_USD=1000

# Set to "true" to deploy a mock World ID contract on testnet instead of official router
USE_MOCK_WORLD_ID=true

# Official Sepolia World ID Router (if not using mock)
WORLD_ID_SEPOLIA_ROUTER=0x719683F13Eeea7D84fCBa5d7d17Bf82e03E3d260

# -------------------------------------------------------------
# 3. 1INCH & DEX ROUTING (OPTIONAL)
# -------------------------------------------------------------
# 1inch Developer Portal API Key
ONEINCH_API_KEY=your_1inch_api_key_here
`;

const rootEnvPath = path.join(__dirname, '.env');
const contractsEnvPath = path.join(__dirname, 'contracts/.env');
const backendEnvPath = path.join(__dirname, 'backend/.env');

fs.writeFileSync(rootEnvPath, envTemplate);
fs.writeFileSync(contractsEnvPath, envTemplate);
fs.writeFileSync(backendEnvPath, envTemplate);

console.log("=========================================================");
console.log("✅ Created .env files in root, /contracts, and /backend!");
console.log("Please edit the .env file with your Sepolia private key & RPC URL.");
console.log("=========================================================");

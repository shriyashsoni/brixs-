import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

const LOCAL_DEFAULTS = {
  AegisSubnameRegistry: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  WorldIDVerifier: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  AegisExecutionManager: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
  AegisSwapVMAdapter: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
  AegisUniswapV4Hook: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
};

// Precedence: local Hardhat defaults < deployed contracts.json < explicit CONTRACT_* env vars
let contractAddresses = { ...LOCAL_DEFAULTS };

// tsc does not copy JSON into dist/, so also look in src/config when running the build
const deployedConfigPath = [
  path.join(__dirname, 'contracts.json'),
  path.resolve(__dirname, '../../src/config/contracts.json'),
].find((p) => fs.existsSync(p));
if (deployedConfigPath) {
  try {
    const deployed = JSON.parse(fs.readFileSync(deployedConfigPath, 'utf-8'));
    if (deployed.contracts) {
      contractAddresses = { ...contractAddresses, ...deployed.contracts };
    }
  } catch (err) {
    console.warn('Could not parse contracts.json, using defaults or env vars.');
  }
}

const envOverrides: Partial<typeof LOCAL_DEFAULTS> = {
  AegisSubnameRegistry: process.env.CONTRACT_REGISTRY,
  WorldIDVerifier: process.env.CONTRACT_WORLD_ID,
  AegisExecutionManager: process.env.CONTRACT_EXECUTION_MANAGER,
  AegisSwapVMAdapter: process.env.CONTRACT_SWAPVM_ADAPTER,
  AegisUniswapV4Hook: process.env.CONTRACT_UNISWAP_HOOK,
};
for (const [key, value] of Object.entries(envOverrides)) {
  if (value) contractAddresses[key as keyof typeof LOCAL_DEFAULTS] = value;
}

// Treat template placeholders as "not configured"
const realValue = (v?: string) => (v && !/your_|_here$|^0x_/i.test(v) ? v : undefined);

const isProduction = process.env.NODE_ENV === 'production';

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  // Local-only in development; hosting platforms need 0.0.0.0 in production
  host: process.env.HOST || (isProduction ? '0.0.0.0' : '127.0.0.1'),
  env: process.env.NODE_ENV || 'development',
  isProduction,
  // Public URL the site is served from (used for CORS). Empty = same origin only in production.
  publicOrigin: process.env.PUBLIC_ORIGIN || '',
  rpcUrl: process.env.SEPOLIA_RPC_URL || 'http://127.0.0.1:8545',
  expectedChainId: parseInt(process.env.CHAIN_ID || '11155111', 10),
  // Relayer key: signs World ID attestations the contract checks (must equal the manager's relayerSigner)
  privateKey: realValue(process.env.PRIVATE_KEY) || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  rootEnsName: process.env.ENS_ROOT_NAME || 'shriyash.eth',
  worldIdAppId: process.env.WORLD_ID_APP_ID || 'app_staging_aegisnet_2026',
  worldIdAction: process.env.WORLD_ID_ACTION || 'agent-high-value-auth',
  // "cloud" (default) verifies proofs with the World ID Developer API; "dev" accepts any
  // well-formed nullifier and must only be used for local testing
  worldIdVerifyMode: (process.env.WORLD_ID_VERIFY_MODE === 'dev' ? 'dev' : 'cloud') as 'cloud' | 'dev',
  // "device" lets any World App user verify; "orb" requires Orb-verified humans
  worldIdVerificationLevel: process.env.WORLD_ID_VERIFICATION_LEVEL === 'orb' ? 'orb' : 'device',
  biometricDefaultThresholdUSD: parseFloat(process.env.BIOMETRIC_THRESHOLD_USD || '1000'),
  oneInchApiKey: realValue(process.env.ONEINCH_API_KEY),
  // Required in production for routes that spend from the backend wallet (x-api-key header)
  adminApiKey: realValue(process.env.ADMIN_API_KEY),
  // Claude AI strategy planner (falls back to deterministic rules when unset)
  anthropicApiKey: realValue(process.env.ANTHROPIC_API_KEY),
  claudeModel: process.env.CLAUDE_MODEL || 'claude-opus-5',
  // First block to index; auto-detected from the manager's deployment when unset
  indexerStartBlock: process.env.INDEXER_START_BLOCK ? parseInt(process.env.INDEXER_START_BLOCK, 10) : undefined,
  dataDir: process.env.DATA_DIR || path.resolve(__dirname, '../../data'),
  contracts: contractAddresses,
};

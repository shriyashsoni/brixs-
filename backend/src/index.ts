import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { ethers } from 'ethers';
import { config } from './config';
import { provider, signerAddress, getChainId } from './chain';
import { HttpError } from './validate';
import { securityHeaders } from './middleware';
import { AdapterABI, HookABI, ManagerABI, RegistryABI } from './abis';
import { indexer } from './services/indexer.service';
import { claudePlanner } from './services/claudePlanner.service';
import agentRoutes from './routes/agent.routes';
import ensRoutes from './routes/ens.routes';
import worldidRoutes from './routes/worldid.routes';
import executionRoutes from './routes/execution.routes';
import uniswapRoutes from './routes/uniswap.routes';

const app = express();
app.disable('x-powered-by');
// Behind a hosting proxy (Render, Railway, Fly…) so rate limits see real client IPs
if (config.isProduction) app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(
  cors(
    config.isProduction
      ? { origin: config.publicOrigin ? config.publicOrigin.split(',').map((s) => s.trim()) : false }
      : undefined
  )
);
app.use(express.json({ limit: '100kb' }));

// ---------------------------------------------------------------------------
// Startup checks, surfaced in /api/health
// ---------------------------------------------------------------------------
const checks = {
  chainIdOk: null as boolean | null,
  relayerOk: null as boolean | null,
  relayerOnchain: null as string | null,
  hookOwner: null as string | null,
};

async function runChecks() {
  try {
    const chainId = await getChainId();
    checks.chainIdOk = chainId === config.expectedChainId;
    const manager = new ethers.Contract(config.contracts.AegisExecutionManager, ManagerABI, provider);
    checks.relayerOnchain = await manager.relayerSigner();
    checks.relayerOk = checks.relayerOnchain!.toLowerCase() === signerAddress.toLowerCase();
    const hook = new ethers.Contract(config.contracts.AegisUniswapV4Hook, HookABI, provider);
    checks.hookOwner = await hook.owner();
    if (!checks.chainIdOk) console.warn(`⚠ RPC chain ${chainId} ≠ expected ${config.expectedChainId}`);
    if (!checks.relayerOk) {
      console.warn(`⚠ PRIVATE_KEY (${signerAddress}) is not the manager's relayerSigner (${checks.relayerOnchain}). World ID approvals will be rejected onchain.`);
    }
  } catch (err: any) {
    console.warn('⚠ Startup checks failed:', err.shortMessage || err.message);
  }
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------
app.get('/api/health', async (_req, res) => {
  const chainId = await getChainId();
  res.json({
    status: 'online',
    protocol: 'AegisNet: Agentic DeFi Matrix',
    network: chainId === 11155111 ? 'Sepolia' : chainId === 31337 ? 'Local Hardhat' : chainId ? `Chain ${chainId}` : 'RPC unreachable',
    chainId,
    expectedChainId: config.expectedChainId,
    rpcReachable: chainId !== null,
    environment: config.env,
    rootEnsName: config.rootEnsName,
    biometricThresholdUSD: config.biometricDefaultThresholdUSD,
    relayer: { address: signerAddress, matchesContract: checks.relayerOk, onchain: checks.relayerOnchain },
    hookOwner: checks.hookOwner,
    worldId: {
      appId: config.worldIdAppId,
      action: config.worldIdAction,
      verifyMode: config.worldIdVerifyMode,
      verificationLevel: config.worldIdVerificationLevel,
    },
    ai: { enabled: claudePlanner.enabled, model: claudePlanner.enabled ? claudePlanner.model : null },
    oneInchQuotes: Boolean(config.oneInchApiKey),
    adminRoutes: config.adminApiKey ? 'api-key' : config.isProduction ? 'disabled' : 'open (development)',
    indexer: indexer.status(),
    contracts: config.contracts,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/abis', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ registry: RegistryABI, manager: ManagerABI, hook: HookABI, adapter: AdapterABI });
});

// ---------------------------------------------------------------------------
// Route modules
// ---------------------------------------------------------------------------
app.use('/api/agent', agentRoutes);
app.use('/api/ens', ensRoutes);
app.use('/api/worldid', worldidRoutes);
app.use('/api/execution', executionRoutes);
app.use('/api/uniswap', uniswapRoutes);

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'API route not found')));

// ---------------------------------------------------------------------------
// Frontend + vendored browser libraries (no third-party CDN at runtime)
// ---------------------------------------------------------------------------
const backendRoot = path.resolve(__dirname, '..');
const vendor: Record<string, string> = {
  'ethers.umd.min.js': path.join(backendRoot, 'node_modules/ethers/dist/ethers.umd.min.js'),
  'idkit.js': path.join(backendRoot, 'node_modules/@worldcoin/idkit-standalone/build/index.global.js'),
};
app.get('/vendor/:file', (req, res, next) => {
  const file = vendor[req.params.file];
  if (!file || !fs.existsSync(file)) return next(new HttpError(404, 'Not found'));
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(file);
});

app.use(express.static(path.resolve(__dirname, '../../frontend'), { extensions: ['html'] }));

// JSON errors for everything, including malformed request bodies
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : err.type === 'entity.parse.failed' ? 400 : err.status || 500;
  const message = err.type === 'entity.parse.failed' ? 'Request body is not valid JSON' : err.message || 'Internal server error';
  if (status >= 500) console.error(err);
  res.status(status).json({ success: false, error: status >= 500 && config.isProduction && !(err instanceof HttpError) ? 'Internal server error' : message });
});

app.listen(config.port, config.host, () => {
  console.log(`=======================================================`);
  console.log(`🛡️  AegisNet listening on ${config.host}:${config.port} (${config.env})`);
  console.log(`🖥️  App:     http://localhost:${config.port}`);
  console.log(`🌐 Health:  http://localhost:${config.port}/api/health`);
  console.log(`🔏 Relayer: ${signerAddress}`);
  console.log(`🔐 World ID: ${config.worldIdVerifyMode} mode · ${config.worldIdVerificationLevel} level`);
  console.log(`🤖 Claude:  ${claudePlanner.enabled ? claudePlanner.model : 'off (set ANTHROPIC_API_KEY)'}`);
  if (config.worldIdVerifyMode === 'dev' && config.isProduction) {
    console.warn('⚠ WORLD_ID_VERIFY_MODE=dev in production: proofs are NOT checked. Do not use this for real users.');
  }
  console.log(`=======================================================`);
  runChecks();
  indexer.start();
});

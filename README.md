# 🛡️ AegisNet: Agentic DeFi Matrix
> **Unifying Autonomous AI Execution with Hierarchical ENSv2 Identity, World ID Biometrics, and 1inch / Uniswap Liquidity**

AegisNet solves the Web3 AI Agent **Trust Trilemma**: absolute wallet vulnerabilities, lack of verifiable human authorization layers, and fragmented execution environments.

---

## 🌟 Sponsor Track Integrations

| Sponsor | Core Feature Integrated | Value Proposition |
| :--- | :--- | :--- |
| **ENS (Ethereum Name Service)** | ENSv2 & Enhanced Access Control (EAC) | Hierarchical agent subname namespaces (`agent1.shriyash.eth`) with role-based target contract permissions and daily spend limits. |
| **World Network** | World ID / Agent Plugin & ZK Biometrics | Zero-knowledge biometric interception (Selfie Check / Proof of Human) for transactions exceeding a configurable threshold ($1,000 USD). |
| **1inch** | SwapVM & Aqua Protocol | Gas-optimized, multi-hop DeFi position routing and custom SwapVM opcode execution (`OP_EXCHANGE_SWAP`, `OP_SPLIT_ROUTE`, `OP_UNISWAP_V4_HOP`). |
| **Uniswap Foundation** | Uniswap v4 Hooks | Agent-gated liquidity pools enforced via `beforeSwap` hooks validating caller identity against ENS subname records. |

---

## 🏗️ Architecture & Component Flow

```
                                    +-----------------------------------------+
                                    |    User Root ENS (shriyash.eth)         |
                                    +-----------------------------------------+
                                                         |
                                                         v
                                    +-----------------------------------------+
                                    |  Phase I: Identity & EAC Delegation     |
                                    |  AegisSubnameRegistry.sol (agent1.eth)  |
                                    +-----------------------------------------+
                                                         |
                                                         v
                                    +-----------------------------------------+
                                    |  Phase II: Strategy & Route Builder     |
                                    |  AIAgent + 1inch SwapVM Opcodes         |
                                    +-----------------------------------------+
                                                         |
                                      Is Transaction Value >= $1,000 Threshold?
                                              /                      \
                                        YES  /                        \ NO
                                            v                          v
                        +-------------------------------+   +-----------------------------+
                        | Phase III: Biometric Gate    |   | Phase IV: Direct Execution  |
                        | World ID ZK Proof / Relayer   |   | AegisExecutionManager.sol   |
                        +-------------------------------+   +-----------------------------+
                                            |                              |
                                            +--------------+---------------+
                                                           |
                                                           v
                                            +-----------------------------+
                                            |  1inch SwapVM Router        |
                                            |  Uniswap v4 beforeSwap Hook |
                                            +-----------------------------+
```

---

## 📁 Repository Structure

```
d:\AegisNet\
├── contracts/                        # Solidity Smart Contracts (Hardhat)
│   ├── contracts/
│   │   ├── AegisSubnameRegistry.sol  # ENSv2 Subname & EAC Access Control
│   │   ├── AegisExecutionManager.sol # Execution Orchestrator & World ID Gatekeeper
│   │   ├── AegisSwapVMAdapter.sol    # 1inch SwapVM Opcode Router
│   │   ├── AegisUniswapV4Hook.sol    # Uniswap v4 Agent-Gated Hook
│   │   └── mocks/                    # Mock ERC20 and Mock World ID Verifier
│   ├── test/
│   │   └── AegisNet.test.js          # Full Protocol Integration Test Suite
│   ├── scripts/
│   │   └── deploy.js                 # Contract Deployment Script
│   └── hardhat.config.js
└── backend/                          # TypeScript Node.js API & AI Agent Engine
    ├── src/
    │   ├── config/                   # Contract & Environment Config
    │   ├── services/                 # ENS, World ID, 1inch SwapVM & Uniswap Services
    │   ├── routes/                   # REST API Endpoints (/agent, /ens, /worldid, /execution)
    │   └── index.ts                  # Server Entrypoint
    └── package.json
```

---

## 🚀 Getting Started

### 1. Smart Contracts Setup & Testing

```bash
cd contracts
npm install
npm test
```

To deploy contracts locally or to Sepolia:
```bash
# Local Hardhat Node
npx hardhat node

# Deploy (in another terminal)
npm run deploy
```

### 2. Backend + Web App

```bash
cd backend
cp .env.example .env      # then fill it in (see the checklist below)
npm install
npm run build
npm start
```

Open `http://localhost:4000`. The landing page, the console (`/app.html`), the docs and the API are all served by this one process.

---

## ⛓️ How the app works (all real, on Sepolia)

| Action | Who signs | Contract call |
| :--- | :--- | :--- |
| Register an agent (+ whitelist SwapVM adapter and Uniswap hook) | Your wallet | `registerSubname`, `setTargetContractWhitelist` ×2 |
| Change threshold, whitelist, text records, revoke | Your wallet (owner) | `updateBiometricThreshold`, `setTargetContractWhitelist`, `setTextRecord`, `revokeSubname` |
| Submit a trade | The agent's wallet | `requestExecution` (under the threshold it also executes in the same tx) |
| Approve a paused trade | Owner's World ID + wallet | `/api/worldid/attest`, then `verifyBiometricsWithRelayer` + `executeVerifiedTransaction` |
| Cancel a trade | Owner or agent wallet | `cancelExecution` |
| Gate a Uniswap v4 pool | Hook owner wallet | `setPoolGated` |

The backend never holds user keys and never pays for user actions. It does only what must happen off-chain:

- **AI planning:** `POST /api/agent/propose`. Claude (`CLAUDE_MODEL`, default `claude-opus-5`) picks the strategy and explains it in plain English. Deterministic code then builds the SwapVM calldata, so the model can't produce arbitrary transactions. Without `ANTHROPIC_API_KEY`, a rule-based planner is used.
- **World ID verification:** `POST /api/worldid/attest` checks the IDKit proof with World's Developer API, using the request ID as the signal. It binds each agent owner to one verified human and derives a per-request nullifier (World ID returns the same nullifier every time a person verifies an action, and the contract marks nullifiers as used). It then signs the relayer attestation the contract checks.
- **Indexing:** the backend reads contract events, so `/api/execution/requests` and `/api/ens/agents` show real onchain history.

## 🧪 Testing

- Contracts: `cd contracts && npm test`
- Full user flow on a local chain (register → AI plan → trade → World ID → approve → execute → cancel → revoke, 19 checks):
  1. `cd contracts && npx hardhat node`
  2. Back up `contracts/deployment-config.json` and `backend/src/config/contracts.json` (the local deploy overwrites them), then run `npm run deploy` and restore the backups.
  3. Start the backend on port 4200 against `http://127.0.0.1:8545` with `CHAIN_ID=31337 WORLD_ID_VERIFY_MODE=dev INDEXER_START_BLOCK=0` and the local `CONTRACT_*` addresses.
  4. `cd backend && npm run test:e2e`

## 🚢 Deploy

The repo ships a production `Dockerfile` that serves the API, landing page and console from one container.

```bash
docker build -t aegisnet .
docker run -p 4000:4000 --env-file backend/.env -e NODE_ENV=production -v aegis-data:/app/data aegisnet
```

Any container host works (Render, Railway, Fly.io, a VPS). Checklist for production:

1. `NODE_ENV=production` binds `0.0.0.0`, locks the admin routes and restricts CORS to `PUBLIC_ORIGIN`.
2. `WORLD_ID_VERIFY_MODE=cloud` (the default). In the World Developer Portal, create the `WORLD_ID_ACTION` action and allow **unlimited** verifications per user.
3. `PRIVATE_KEY` must be the manager's `relayerSigner`. `/api/health` → `relayer.matchesContract` must be `true`.
4. Mount a volume at `/app/data` so the chain index and World ID bindings survive restarts.
5. Optional: `ANTHROPIC_API_KEY` for Claude planning, `ONEINCH_API_KEY` for live price quotes, `ADMIN_API_KEY` to enable the bot routes.

## ⚠️ Known limitations (contract level)

These need contract changes and a redeploy. The backend and console already work around them where they can.

- **Swaps are simulated inside `AegisSwapVMAdapter`.** Identity, limits, the World ID gate and execution are real onchain, but the adapter returns computed amounts instead of moving tokens. Wiring it to real DEX liquidity on Sepolia is the next step.
- **`AegisSubnameRegistry.recordSpend` has no access control.** Anyone can call it and push an agent's daily spend up, which blocks its trades for the day. It should be restricted to the execution manager.
- **The daily limit is checked only at execution.** A trade over the limit can still be queued. The console refuses to submit it and the backend refuses to attest it.
- **`AegisUniswapV4Hook.beforeSwap` checks `tx.origin == executionManager`,** which can never be true for a contract. It also isn't registered with a real Uniswap v4 PoolManager yet.
- **Agent names live in AegisNet's own registry,** not in ENS's NameWrapper, so they don't resolve in ENS apps yet.
- **Rate limits and World ID bindings are per instance** (in memory and on disk). Run a single instance, or move them to Redis or a database before scaling out.

---

## 🔌 API Key & Environment Checklist for User

To connect production accounts, create/update `.env` in `backend/` and `contracts/` with your credentials:

1. **Sepolia RPC URL / Private Key**:
   - `SEPOLIA_RPC_URL`: Your Alchemy / Infura / Ankr Sepolia RPC endpoint.
   - `PRIVATE_KEY`: Private key of the account owning the root ENS domain (e.g. `shriyash.eth`).

2. **World ID Credentials**:
   - `WORLD_ID_APP_ID`: App ID from Worldcoin Developer Portal (`https://developer.worldcoin.org`).
   - `WORLD_ID_ACTION`: Action name created in World Developer Portal (e.g. `agent-high-value-auth`).

3. **ENS Root Name**:
   - `ENS_ROOT_NAME`: Root ENS name owned on Sepolia (e.g. `shriyash.eth`).

4. **1inch API Key (optional)**:
   - `ONEINCH_API_KEY`: 1inch Developer Portal key for live mainnet price quotes in plans.

5. **Claude (optional, recommended)**:
   - `ANTHROPIC_API_KEY`: turns on the Claude strategy planner (`CLAUDE_MODEL`, default `claude-opus-5`).

6. **Admin (production)**:
   - `ADMIN_API_KEY`: enables the routes where the backend wallet itself sends transactions (bots and scripts). The console never needs it.

See `backend/.env.example` for every option.

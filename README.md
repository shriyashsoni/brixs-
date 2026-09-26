# 🛡️ AegisNet

**Guardrails for autonomous AI agents on Ethereum.** Each agent gets an ENS-style identity with hard limits enforced onchain. Claude plans every trade in plain English, and large trades pause until a verified human approves them with World ID.

> Live on **Ethereum Sepolia** · Contracts in Solidity 0.8.24 · Backend in TypeScript · Wallet-signed web app

| | |
| :--- | :--- |
| **Network** | Ethereum Sepolia (chain ID `11155111`) |
| **Root name** | `shriyash.eth` |
| **Contracts** | 5 deployed ([addresses](#-deployed-contracts-sepolia)) |
| **Integrations** | ENS · World ID · 1inch SwapVM & Aqua · Uniswap v4 hooks · Anthropic Claude |

---

## Table of contents

1. [The problem](#-the-problem)
2. [How AegisNet solves it](#-how-aegisnet-solves-it)
3. [Deployed contracts (Sepolia)](#-deployed-contracts-sepolia)
4. [Live onchain proof](#-live-onchain-proof)
5. [Integrations](#-integrations)
6. [Architecture](#-architecture)
7. [How a trade flows](#-how-a-trade-flows)
8. [Security model](#-security-model)
9. [Repository structure](#-repository-structure)
10. [Getting started](#-getting-started)
11. [Configuration](#-configuration)
12. [REST API](#-rest-api)
13. [Smart contract reference](#-smart-contract-reference)
14. [Testing](#-testing)
15. [Deployment](#-deployment)
16. [Known limitations & roadmap](#-known-limitations--roadmap)

---

## 🎯 The problem

To trade on your behalf, an AI agent needs a wallet key. That creates three problems at once:

1. **Unlimited power.** A raw private key can do anything. If the agent is buggy, hacked or prompt-injected, it can empty the wallet in seconds.
2. **No human in the loop.** Nothing forces a real person to confirm a large or unusual move.
3. **No identity or accountability.** An agent is just an address, with no name, owner or rules attached to it.

## 💡 How AegisNet solves it

| Layer | What it does | Where |
| :--- | :--- | :--- |
| **Identity & limits** | Every agent is registered as `name.shriyash.eth` with an owner, a whitelist of contracts it may call, a daily spending limit and an approval threshold. | `AegisSubnameRegistry` |
| **Execution gate** | Agents can't act directly. They submit requests to the manager, which checks identity and whitelist onchain. Under the threshold a trade runs immediately; at or above it, the trade pauses. | `AegisExecutionManager` |
| **Proof of human** | A paused trade executes only after the owner verifies with **World ID**. The proof is tied to that exact request, and each owner is bound to one verified human. | Backend + `AegisExecutionManager` |
| **AI planning** | **Claude** turns a plain-English goal into a strategy and explains it. Deterministic code, not the model, builds the transaction. | Backend |
| **Routing** | Strategies compile to **1inch SwapVM** opcodes, including an **agent-gated Uniswap v4 hook** hop. | `AegisSwapVMAdapter`, `AegisUniswapV4Hook` |
| **Kill switch** | The owner can cancel any pending trade, lower limits or revoke the agent in one transaction. | `AegisSubnameRegistry`, `AegisExecutionManager` |

**The result:** small trades run by themselves, big trades wait for a human, and bad trades are blocked or cancelled.

---

## 📜 Deployed contracts (Sepolia)

| Contract | Address | Role |
| :--- | :--- | :--- |
| **AegisSubnameRegistry** | [`0x09FfDB167F80fF9E4C5BE64C24bEbeCF1F4B4625`](https://sepolia.etherscan.io/address/0x09FfDB167F80fF9E4C5BE64C24bEbeCF1F4B4625) | Agent identities, owners, whitelists, limits, ENSIP-26 text records |
| **AegisExecutionManager** | [`0xC65d65A48cB24CA9bd6df02Ea83Ef44571E5594c`](https://sepolia.etherscan.io/address/0xC65d65A48cB24CA9bd6df02Ea83Ef44571E5594c) | Request queue, World ID gate, execution, cancellation |
| **AegisSwapVMAdapter** | [`0xc2CA4DB9A01367fA06F56dcf8681993b517D19f1`](https://sepolia.etherscan.io/address/0xc2CA4DB9A01367fA06F56dcf8681993b517D19f1) | 1inch SwapVM opcode router (manager-only) |
| **AegisUniswapV4Hook** | [`0x0F491f0D3CfB919A259E69F974Ae772912f13B2e`](https://sepolia.etherscan.io/address/0x0F491f0D3CfB919A259E69F974Ae772912f13B2e) | Agent-gated `beforeSwap` hook |
| **WorldIDVerifier** | [`0xedd0bb0F06a2c12DC502165d98fbbba6701a12Ba`](https://sepolia.etherscan.io/address/0xedd0bb0F06a2c12DC502165d98fbbba6701a12Ba) | Mock verifier for the onchain ZK path on testnet (approvals in the app use the relayer attestation path) |

- **Deployer, protocol owner and relayer signer:** [`0x9eeAb92431FD385981735dbF5B949b6C4c2eBC39`](https://sepolia.etherscan.io/address/0x9eeAb92431FD385981735dbF5B949b6C4c2eBC39)
- **Deployment record:** [`contracts/deployment-config.json`](contracts/deployment-config.json), mirrored to [`backend/src/config/contracts.json`](backend/src/config/contracts.json)

## 🔗 Live onchain proof

Real transactions on Sepolia, made through these contracts by agent `agent1.shriyash.eth`:

| What happened | Transaction |
| :--- | :--- |
| Agent `agent1.shriyash.eth` registered | [`0x3156c01b…6d4d`](https://sepolia.etherscan.io/tx/0x3156c01b0e9aad93714adc60d271e34aa53269517897c21cc7b1d703deb66d4d) |
| $500 trade: under the threshold, executed in the same transaction | [`0x2e9c6287…1c1c`](https://sepolia.etherscan.io/tx/0x2e9c628703817b597085eea8f18ad83bb4af2911371ab4950326fbb1da9b6c1c) |
| $5,000 trade: paused onchain for World ID | [`0x16dbde9f…0843`](https://sepolia.etherscan.io/tx/0x16dbde9f959b5888e73be12242c802d6edb449275f2b64c00094ede7d7890843) |
| $5,000 trade: World ID approval recorded | [`0xe8727000…4a23`](https://sepolia.etherscan.io/tx/0xe8727000356eac97aaa3016fded601610d84c3d16f000599caf0be8503e84a23) |
| $5,000 trade: executed after approval | [`0x464cbae2…a442`](https://sepolia.etherscan.io/tx/0x464cbae20084ce7b818e7e91e0ed5b0afc7614951dd1fcada3cd36a94a0ca442) |
| $250 trade: under the threshold, executed in the same transaction | [`0xb97675a0…543f`](https://sepolia.etherscan.io/tx/0xb97675a0cebb90e74be8c23d13c44cb5f08087f511c40f6ea656d5ce3d50543f) |

---

## 🤝 Integrations

### ENS: agent identity & access control
- Each agent gets a hierarchical name under the root, for example `agent1.shriyash.eth`. Its node is `keccak256(rootNode, keccak256(label))`, following ENS namehash.
- **Enhanced Access Control (EAC):** a per-agent whitelist of callable contracts, a daily spending limit and a biometric threshold, all checked by `isAgentAuthorized`.
- **ENSIP-26 text records** such as `agent.capabilities` and `agent.description`.

### World: proof of human with World ID
- The owner verifies with **World App** through the official **IDKit** widget, using the request ID as the signal.
- The backend verifies the proof with the **World ID Developer API** (`/api/v2/verify`). It then signs the attestation that `verifyBiometricsWithRelayer` checks onchain.
- Each owner is bound to one verified human. A per-request nullifier gives replay protection for every trade: World ID returns the same nullifier every time a person verifies an action, so using it directly would allow one approval per person, ever.

### 1inch: SwapVM & Aqua
- Strategies compile to custom SwapVM instruction lists executed by `AegisSwapVMAdapter`:

| Opcode | Name | Purpose |
| :---: | :--- | :--- |
| `0x01` | `OP_EXCHANGE_SWAP` | Direct aggregator swap |
| `0x02` | `OP_SPLIT_ROUTE` | Split order across liquidity sources |
| `0x03` | `OP_VERIFY_MIN_OUTPUT` | Slippage guard, reverts below the minimum |
| `0x04` | `OP_UNISWAP_V4_HOP` | Hop through the agent-gated Uniswap v4 hook |
| `0x05` | `OP_AQUA_DEPOSIT` | Open a 1inch Aqua liquidity position |
| `0x06` | `OP_AQUA_WITHDRAW` | Rebalance and harvest the Aqua position |

- Optional live mainnet price quotes come from the **1inch Swap API** (`ONEINCH_API_KEY`).

### Uniswap Foundation: v4 hooks
- `AegisUniswapV4Hook.beforeSwap` checks the trading agent's permissions in the registry. It refuses any trade that would need biometric approval, so the World ID gate can't be bypassed.
- Pools can be switched to agents-only with `setPoolGated` (hook owner only).

### Anthropic: Claude strategy planner
- `POST /api/agent/propose` asks Claude for a structured plan: strategy type, token pair, Uniswap hop, a plain-English summary, rationale and risk notes. Claude sees the agent's real threshold and remaining daily limit.
- It uses **structured outputs**, adaptive thinking and server-side refusal fallbacks. The model is `claude-opus-5` by default and can be changed with `CLAUDE_MODEL`.
- **Safety:** the model only chooses from a fixed set of options. Calldata is always built by deterministic code, and the contract enforces limits no matter what the plan says.
- Without `ANTHROPIC_API_KEY`, a deterministic rule-based planner is used instead.

---

## 🏗️ Architecture

```
┌──────────────────────────── Browser ─────────────────────────────┐
│  Landing page · Console · Docs                                   │
│  Wallet (EIP-6963, any extension)      World ID widget (IDKit)   │
└───────────┬───────────────────────────────────────┬──────────────┘
            │ signs every onchain action            │ proof
            ▼                                       ▼
┌──────────────────────── Ethereum Sepolia ───────┐ ┌──────── Backend (Node/Express) ─────────┐
│ AegisSubnameRegistry   identity · limits        │ │ Claude planner   plan → calldata        │
│ AegisExecutionManager  queue · gate · execute   │◄┤ World ID gate    verify → attestation   │
│ AegisSwapVMAdapter     1inch SwapVM opcodes     │ │ Chain indexer    events → activity      │
│ AegisUniswapV4Hook     agent-gated beforeSwap   │►┤ Serves the web app + vendored libs      │
└─────────────────────────────────────────────────┘ └─────────────────────────────────────────┘
```

**Design principles**

- **Users sign, the server doesn't.** Registering, changing limits, trading, approving and cancelling are all signed by the user's own wallet. The backend never holds user keys and never pays for user actions.
- **AI proposes, code decides.** Claude's output is restricted to a schema. Transactions are built deterministically and enforced onchain.
- **The chain is the source of truth.** Activity and agent lists come from contract events, not a private database.

---

## 🔄 How a trade flows

```
1. Plan      POST /api/agent/propose           → Claude plan + encoded SwapVM calldata
2. Submit    agent wallet → requestExecution(adapter, calldata, valueUSD)
               ├─ under the threshold → executes in the same transaction ✅
               └─ at or above        → ExecutionRequested(requiresBiometrics = true) ⏸
3. Verify    owner scans with World App (IDKit, signal = requestId)
             POST /api/worldid/attest          → relayer signature + per-request nullifier
4. Approve   owner wallet → verifyBiometricsWithRelayer(requestId, nullifier, signature)
5. Execute   owner wallet → executeVerifiedTransaction(requestId)   ✅
   or Cancel owner/agent wallet → cancelExecution(requestId)        ❌ funds never move
```

| Action | Signed by | Contract call |
| :--- | :--- | :--- |
| Register an agent (+ allow the SwapVM adapter and Uniswap hook) | Owner wallet | `registerSubname`, `setTargetContractWhitelist` ×2 |
| Change threshold, whitelist, text records, revoke | Owner wallet | `updateBiometricThreshold`, `setTargetContractWhitelist`, `setTextRecord`, `revokeSubname` |
| Submit a trade | Agent wallet | `requestExecution` |
| Approve a paused trade | Owner's World ID + wallet | `/api/worldid/attest` → `verifyBiometricsWithRelayer` → `executeVerifiedTransaction` |
| Cancel a trade | Owner or agent wallet | `cancelExecution` |
| Gate a Uniswap v4 pool | Hook owner wallet | `setPoolGated` |

---

## 🔐 Security model

**Onchain guarantees**
- Only registered, active agents can submit requests, and only to whitelisted targets. Anything else reverts with `Agent or target not authorized by ENS EAC`.
- A request at or above the threshold can't execute until a valid relayer attestation is recorded.
- Relayer signatures cover `(requestId, nullifier, manager, chainId)`, so they can't be replayed across requests, contracts or chains. Used nullifiers are recorded onchain.
- Only the owner, the agent or the protocol owner can cancel a request. The daily spending limit is enforced when the trade executes.

**Backend guarantees**
- A World ID proof is only accepted for a request that exists onchain and is still pending, tied to that request by the signal.
- Each owner is bound to one verified human: after the first approval, a different World ID is refused.
- Trades that would exceed the daily limit are flagged in the plan, blocked in the console and refused at attestation, so no gas is wasted on a trade certain to revert.
- In production (`NODE_ENV=production`):
  - Routes that make the backend wallet transact are disabled unless `ADMIN_API_KEY` is set, and then need the `x-api-key` header.
  - Security headers, strict CORS and per-IP rate limits on the AI and World ID endpoints.
- At startup the backend checks that its key is the contract's `relayerSigner` and reports the result in `/api/health`.

---

## 📁 Repository structure

```
.
├── contracts/                         Hardhat project
│   ├── contracts/
│   │   ├── AegisSubnameRegistry.sol   Identity, EAC permissions, text records
│   │   ├── AegisExecutionManager.sol  Request queue, World ID gate, execution
│   │   ├── AegisSwapVMAdapter.sol     1inch SwapVM / Aqua opcode router
│   │   ├── AegisUniswapV4Hook.sol     Agent-gated beforeSwap hook
│   │   ├── interfaces/                IAegisSubnameRegistry, IWorldID
│   │   └── mocks/                     MockERC20, MockWorldID
│   ├── scripts/                       deploy.js (local), deploy-sepolia.js, execute-sepolia-demo.js
│   ├── test/AegisNet.test.js          Protocol test suite
│   └── deployment-config.json         Sepolia deployment record
├── backend/                           TypeScript API (Express + ethers v6)
│   ├── src/
│   │   ├── index.ts                   Server, health, security, static app
│   │   ├── abis.ts                    Contract ABIs (also served to the browser)
│   │   ├── chain.ts                   Provider, signer, serialized tx sending
│   │   ├── middleware.ts              Admin gate, rate limiter, security headers
│   │   ├── routes/                    agent · ens · execution · worldid · uniswap
│   │   └── services/
│   │       ├── claudePlanner.service.ts   Claude structured-output planner
│   │       ├── aiAgent.service.ts         Plan → SwapVM calldata, limit checks, quotes
│   │       ├── worldid.service.ts         Proof check, human binding, attestation
│   │       ├── indexer.service.ts         Contract event indexer
│   │       └── swapvm / ens / uniswap / execution services
│   ├── test/e2e.local.js              Full user-flow test (19 checks)
│   └── .env.example                   Every configuration option, documented
├── frontend/                          Static web app served by the backend
│   ├── index.html                     Landing page
│   ├── app.html · app.js · app.css    Console (dashboard, agents, AI strategy, trade, activity)
│   ├── wallet.js                      Multi-wallet connect (EIP-6963), Sepolia switching
│   ├── chain.js                       Wallet-signed contract calls
│   └── docs.html · whitepaper.html
├── Dockerfile                         Production image (API + app)
└── .gitignore / .dockerignore         Secrets and build output excluded
```

---

## 🚀 Getting started

### Prerequisites
- Node.js **20+**
- A browser wallet (MetaMask, Rabby, Coinbase Wallet…) with a little **Sepolia ETH** ([faucet](https://www.alchemy.com/faucets/ethereum-sepolia))
- [World App](https://world.org/world-app) to approve large trades
- Optional: an [Anthropic API key](https://console.anthropic.com/) for Claude planning

### 1. Clone and install
```bash
git clone https://github.com/shriyashsoni/brixs-.git
cd brixs-
cd contracts && npm install
cd ../backend && npm install
```

### 2. Configure
```bash
cp backend/.env.example backend/.env
# fill in SEPOLIA_RPC_URL, PRIVATE_KEY (relayer), WORLD_ID_APP_ID, and optionally ANTHROPIC_API_KEY
```

### 3. Run
```bash
cd backend
npm run build
npm start
```
Open **http://localhost:4000**:

| Page | URL |
| :--- | :--- |
| Landing page | `/` |
| Console | `/app.html` |
| Docs | `/docs.html` |
| Whitepaper | `/whitepaper.html` |
| Health | `/api/health` |

### 4. Try it
1. **Connect wallet** (the app offers to switch to Sepolia).
2. **Agents → Register an agent.** Three confirmations; your wallet becomes the owner and the agent.
3. **Trade → $250.** It executes immediately.
4. **Trade → $2,500.** It pauses; scan with World App, then confirm the approval and execution.
5. **Start & cancel** a trade to see the kill switch work.

### Deploy your own contracts (optional)
```bash
cd contracts
# contracts/.env: SEPOLIA_RPC_URL, PRIVATE_KEY, ENS_ROOT_NAME, USE_MOCK_WORLD_ID
npm run deploy:sepolia      # writes deployment-config.json and backend/src/config/contracts.json
```

---

## ⚙️ Configuration

All options are documented in [`backend/.env.example`](backend/.env.example). The main ones:

| Variable | Required | Description |
| :--- | :---: | :--- |
| `SEPOLIA_RPC_URL` | ✅ | Sepolia RPC endpoint (Alchemy, Infura…). Archive access lets the indexer find the deploy block automatically. |
| `PRIVATE_KEY` | ✅ | Relayer key that signs World ID attestations. Must be the manager's `relayerSigner`. |
| `WORLD_ID_APP_ID` | ✅ | App ID from the [World Developer Portal](https://developer.worldcoin.org) |
| `WORLD_ID_ACTION` | ✅ | Action ID (for example `agent-high-value-auth`). Allow **unlimited** verifications per user. |
| `WORLD_ID_VERIFY_MODE` | | `cloud` (default, real proofs) or `dev` (no proof check, local testing only) |
| `WORLD_ID_VERIFICATION_LEVEL` | | `device` (default) or `orb` |
| `ENS_ROOT_NAME` | | Root name for agents (default `shriyash.eth`) |
| `BIOMETRIC_THRESHOLD_USD` | | Default approval threshold (default `1000`) |
| `ANTHROPIC_API_KEY` | | Enables the Claude planner |
| `CLAUDE_MODEL` | | Default `claude-opus-5` |
| `ONEINCH_API_KEY` | | Live 1inch mainnet price quotes |
| `NODE_ENV` | | `production` switches on the production protections |
| `ADMIN_API_KEY` | | Enables backend-signed bot routes in production |
| `PUBLIC_ORIGIN` | | Allowed cross-origin site(s) in production |
| `INDEXER_START_BLOCK` | | Skip deploy-block detection |

---

## 🔌 REST API

**Public**

| Method | Endpoint | Description |
| :---: | :--- | :--- |
| `GET` | `/api/health` | Network, relayer check, contracts, World ID, AI and indexer status |
| `GET` | `/api/abis` | Contract ABIs used by the web app |
| `POST` | `/api/agent/propose` | Plan a trade (Claude or rules) and return calldata. Nothing is sent onchain. *Rate limited.* |
| `POST` | `/api/worldid/attest` | Verify a World ID proof for a paused request and return the relayer attestation. *Rate limited.* |
| `GET` | `/api/worldid/config` | World ID widget settings |
| `GET` | `/api/worldid/binding/:owner` | Whether an owner has a bound human |
| `GET` | `/api/execution/requests?agent=&owner=` | Every request, indexed from chain events |
| `GET` | `/api/execution/:requestId` | One request |
| `POST` | `/api/execution/refresh` | Index the latest block now |
| `GET` | `/api/ens/agents?owner=&agent=` | Registered agents |
| `GET` | `/api/ens/permissions/:agentAddress` | An agent's live limits and spend |
| `GET` | `/api/ens/whitelist/:node/:target` | Whether a target is allowed |
| `GET` | `/api/ens/text-record/:node/:key` | ENSIP-26 text record |
| `GET` | `/api/uniswap/pools/:poolId` | Uniswap v4 pool gating |

**Admin** (the backend wallet sends the transaction; `x-api-key` required in production)

| Method | Endpoint |
| :---: | :--- |
| `POST` | `/api/agent/execute` |
| `POST` | `/api/ens/register-subname` · `/whitelist-target` · `/threshold` · `/revoke` · `/text-record` |
| `POST` | `/api/execution/:requestId/execute` · `/cancel` |
| `POST` | `/api/uniswap/pools/gate` |

<details>
<summary>Example: plan a trade</summary>

```bash
curl -X POST http://localhost:4000/api/agent/propose \
  -H 'Content-Type: application/json' \
  -d '{"agentAddress":"0xYourAgent","goalPrompt":"Swap USDC to ETH at the best price","amountUSD":2500}'
```

```json
{
  "success": true,
  "proposal": {
    "planner": "claude",
    "summary": "Swap $2,500 of USDC into ETH through 1inch with an agent-gated Uniswap v4 hop.",
    "strategyType": "split_swap",
    "requiresBiometric2FA": true,
    "authorization": { "isAllowed": true, "requiresBiometrics": true },
    "dailyLimit": { "limitUSD": 50000, "spentTodayUSD": 2750, "remainingUSD": 47250, "exceeds": false }
  },
  "targetContract": "0xc2CA4DB9A01367fA06F56dcf8681993b517D19f1",
  "encodedCallData": "0x…"
}
```
</details>

---

## 📘 Smart contract reference

<details>
<summary><b>AegisSubnameRegistry</b></summary>

```solidity
function registerSubname(string subnameLabel, address agentAddress, uint256 biometricThresholdUSD, uint256 dailySpendingLimit) returns (bytes32 subnameNode);
function setTargetContractWhitelist(bytes32 node, address target, bool isWhitelisted);  // owner
function updateBiometricThreshold(bytes32 node, uint256 newThresholdUSD);              // owner
function revokeSubname(bytes32 node);                                                  // owner
function setTextRecord(bytes32 node, string key, string value);                        // owner
function isAgentAuthorized(address agent, address target, uint256 valueUSD) view returns (bool isAllowed, bool requiresBiometrics, bytes32 node);
function getAgentPermissions(bytes32 node) view returns (AgentPermissions);

event SubnameRegistered(bytes32 indexed subnameNode, string subname, address indexed agent, address indexed owner);
event TargetContractWhitelisted(bytes32 indexed subnameNode, address indexed targetContract, bool isWhitelisted);
event BiometricThresholdUpdated(bytes32 indexed subnameNode, uint256 newThresholdUSD);
event SubnameRevoked(bytes32 indexed subnameNode);
```
USD values use 18 decimals. A daily limit of `0` means unlimited, and a threshold of `0` turns the World ID gate off.
</details>

<details>
<summary><b>AegisExecutionManager</b></summary>

```solidity
function requestExecution(address target, bytes callData, uint256 valueUSD) returns (bytes32 requestId, bool requiresBiometrics);
function verifyBiometricsWithRelayer(bytes32 requestId, uint256 nullifierHash, bytes signature);
function submitBiometricProof(bytes32 requestId, uint256 root, uint256 nullifierHash, uint256[8] proof);  // onchain ZK path
function executeVerifiedTransaction(bytes32 requestId) returns (bool success, bytes returnData);
function cancelExecution(bytes32 requestId);   // owner, agent or protocol owner

event ExecutionRequested(bytes32 indexed requestId, address indexed agent, address indexed targetContract, uint256 valueUSD, bool requiresBiometrics);
event ExecutionBiometricsVerified(bytes32 indexed requestId, uint256 nullifierHash);
event ExecutionExecuted(bytes32 indexed requestId, address indexed targetContract, bool success, bytes returnData);
event ExecutionCancelled(bytes32 indexed requestId);
```
The relayer message is `keccak256(abi.encodePacked(requestId, nullifierHash, address(this), block.chainid))`, signed as an Ethereum signed message.
</details>

<details>
<summary><b>AegisSwapVMAdapter</b></summary>

```solidity
struct SwapInstruction { uint8 opcode; address tokenIn; address tokenOut; uint256 amountIn; uint256 minAmountOut; bytes extraData; }
function executeSwapVMRoute(bytes encodedInstructions) returns (uint256 finalOutputAmount);  // manager only
```
</details>

<details>
<summary><b>AegisUniswapV4Hook</b></summary>

```solidity
function setPoolGated(bytes32 poolId, bool isGated);                                  // hook owner
function beforeSwap(address sender, bytes32 poolId, uint256 amountUSD) returns (bytes4);
```
</details>

---

## 🧪 Testing

**Contract unit tests** (8 passing):
```bash
cd contracts && npm test
```
They cover subname registration and whitelists, biometric flagging, ENSIP-26 text records, auto-execution under the threshold, World ID relayer verification, the gated Uniswap v4 swap, and 1inch Aqua deposit and rebalance.

**Full user-flow test** ([`backend/test/e2e.local.js`](backend/test/e2e.local.js), 19 checks). A user wallet does exactly what the browser does, against a local chain:
- register → AI plan → $250 auto-execution → $2,500 pause → World ID attestation → approve → execute
- the same human approves a second request; a different human is refused
- a stranger can't cancel; the owner can; a cancelled request can't be approved
- an over-limit trade is flagged and refused; an unregistered agent is blocked onchain
- the indexer reports the real history; revoking removes the identity

```bash
# terminal 1
cd contracts && npx hardhat node
# terminal 2: the local deploy overwrites the Sepolia config files, so back them up first and restore after
cd contracts && npm run deploy
# terminal 3: backend against the local chain
cd backend && PORT=4200 CHAIN_ID=31337 WORLD_ID_VERIFY_MODE=dev INDEXER_START_BLOCK=0 \
  SEPOLIA_RPC_URL=http://127.0.0.1:8545 CONTRACT_REGISTRY=… CONTRACT_EXECUTION_MANAGER=… \
  CONTRACT_SWAPVM_ADAPTER=… CONTRACT_UNISWAP_HOOK=… CONTRACT_WORLD_ID=… npm start
# terminal 4
cd backend && npm run test:e2e
```

---

## 🚢 Deployment

The repo ships a production `Dockerfile` that serves the API, landing page and console from one container.

```bash
docker build -t aegisnet .
docker run -p 4000:4000 --env-file backend/.env -e NODE_ENV=production -v aegis-data:/app/data aegisnet
```

It works on any container host (Render, Railway, Fly.io, a VPS). **Production checklist:**

1. `NODE_ENV=production`: binds `0.0.0.0`, locks admin routes and applies strict CORS (`PUBLIC_ORIGIN`).
2. `WORLD_ID_VERIFY_MODE=cloud` (default). The World ID action exists and allows unlimited verifications per user.
3. `/api/health` → `relayer.matchesContract` is `true`.
4. A volume is mounted at `/app/data`, so the chain index and World ID bindings persist.
5. Secrets are set in the host's environment settings. `.env` files are never committed.

---

## 🗺️ Known limitations & roadmap

These need contract changes and a redeploy. The backend and console already work around them where possible.

| Area | Current state | Next step |
| :--- | :--- | :--- |
| **Swap execution** | `AegisSwapVMAdapter` computes output amounts but doesn't move tokens yet. Identity, limits, the World ID gate and execution are fully onchain. | Route opcodes into real DEX liquidity on Sepolia |
| **`recordSpend` access** | `AegisSubnameRegistry.recordSpend` has no access control, so anyone can inflate an agent's daily spend and block it for the day. | Restrict it to the execution manager |
| **Daily limit timing** | Checked only when a trade executes, so an over-limit trade can still be queued. The app blocks it before signing and refuses to attest it. | Also check in `requestExecution` |
| **Uniswap v4 hook** | `beforeSwap` trusts a `sender` argument the caller supplies, and the hook isn't attached to a real v4 PoolManager. | Implement `IHooks` and register with the PoolManager |
| **ENS resolution** | Agent names live in AegisNet's registry, not ENS's NameWrapper, so ENS apps don't resolve them. | Issue subnames through the NameWrapper with a custom resolver |
| **Scaling** | Rate limits and World ID bindings are per instance. | Move them to Redis or a database for multi-instance deployments |

---

## 📄 License

The smart contracts are MIT-licensed (see the SPDX headers in `contracts/contracts`).

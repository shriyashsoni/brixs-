import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';
import { config } from '../config';
import { provider } from '../chain';
import { ManagerABI, RegistryABI } from '../abis';

export type IndexedStatus = 'REQUESTED' | 'PENDING_BIOMETRICS' | 'BIOMETRICS_VERIFIED' | 'EXECUTED' | 'CANCELLED';

export interface IndexedRequest {
  requestId: string;
  status: IndexedStatus;
  agentAddress: string;
  agentSubname: string | null;
  ownerAddress: string | null;
  targetContract: string;
  valueUSD: number;
  requiresBiometrics: boolean;
  txHash: string;
  verificationTxHash?: string;
  executionTxHash?: string;
  cancelTxHash?: string;
  blockNumber: number;
  createdAt: string;
  updatedAt: string;
}

export interface IndexedAgent {
  subnameNode: string;
  label: string;
  subnameFull: string;
  agentAddress: string;
  ownerAddress: string;
  registeredTxHash: string;
  registeredAt: string;
  revoked: boolean;
}

interface Snapshot {
  version: 1;
  contracts: { manager: string; registry: string };
  cursor: number;
  requests: IndexedRequest[];
  agents: IndexedAgent[];
}

const POLL_MS = 12_000;
const MAX_RANGE = 10;
const MIN_RANGE = 1;

/**
 * Reads AegisExecutionManager and AegisSubnameRegistry events from the chain and keeps an
 * up-to-date view of every request and agent. Persists to disk so restarts resume quickly.
 */
export class IndexerService {
  private managerIface = new ethers.Interface(ManagerABI);
  private registryIface = new ethers.Interface(RegistryABI);
  private manager = config.contracts.AegisExecutionManager;
  private registry = config.contracts.AegisSubnameRegistry;
  private file = path.join(config.dataDir, 'chain-index.json');

  private requests = new Map<string, IndexedRequest>();
  private agents = new Map<string, IndexedAgent>(); // by subnameNode
  private cursor = -1; // last fully indexed block
  private head = 0;
  private range = MAX_RANGE;
  private timestamps = new Map<number, number>();
  private running = false;
  private lastError: string | null = null;
  private lastSyncAt: string | null = null;

  constructor() {
    this.load();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  start() {
    if (this.running) return;
    this.running = true;
    const loop = async () => {
      try {
        await this.sync();
        this.lastError = null;
      } catch (err: any) {
        this.lastError = err?.shortMessage || err?.message || String(err);
        console.warn('[indexer]', this.lastError);
      }
      setTimeout(loop, POLL_MS);
    };
    loop();
  }

  status() {
    return {
      cursor: this.cursor,
      head: this.head,
      synced: this.cursor >= 0 && this.head - this.cursor <= 2,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      requests: this.requests.size,
      agents: this.agents.size,
    };
  }

  listRequests(filter: { agent?: string; owner?: string } = {}): IndexedRequest[] {
    const agent = filter.agent?.toLowerCase();
    const owner = filter.owner?.toLowerCase();
    return [...this.requests.values()]
      .filter((r) => !agent || r.agentAddress.toLowerCase() === agent)
      .filter((r) => !owner || (r.ownerAddress || '').toLowerCase() === owner)
      .sort((a, b) => b.blockNumber - a.blockNumber || b.updatedAt.localeCompare(a.updatedAt));
  }

  getRequest(requestId: string): IndexedRequest | undefined {
    return this.requests.get(requestId.toLowerCase());
  }

  listAgents(filter: { owner?: string; agent?: string } = {}): IndexedAgent[] {
    const owner = filter.owner?.toLowerCase();
    const agent = filter.agent?.toLowerCase();
    return [...this.agents.values()]
      .filter((a) => !owner || a.ownerAddress.toLowerCase() === owner)
      .filter((a) => !agent || a.agentAddress.toLowerCase() === agent)
      .sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));
  }

  /** Index up to the latest block now (used right after a user transaction for fast feedback) */
  async refresh() {
    await this.sync();
  }

  // ---------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------
  private syncing: Promise<void> | null = null;

  private sync(): Promise<void> {
    if (!this.syncing) {
      this.syncing = this.doSync().finally(() => {
        this.syncing = null;
      });
    }
    return this.syncing;
  }

  private async doSync() {
    this.head = await provider.getBlockNumber();
    if (this.cursor < 0) this.cursor = (await this.findStartBlock()) - 1;

    while (this.cursor < this.head) {
      const from = this.cursor + 1;
      const to = Math.min(this.head, from + this.range - 1);
      let logs: ethers.Log[];
      try {
        logs = await provider.getLogs({ address: [this.manager, this.registry], fromBlock: from, toBlock: to });
      } catch (err) {
        // Providers cap getLogs ranges differently; shrink and retry
        if (this.range > MIN_RANGE) {
          this.range = Math.max(MIN_RANGE, Math.floor(this.range / 4));
          continue;
        }
        throw err;
      }
      for (const log of logs) await this.apply(log);
      this.cursor = to;
      if (this.range < MAX_RANGE) this.range = Math.min(MAX_RANGE, this.range * 2);
    }

    this.lastSyncAt = new Date().toISOString();
    this.save();
  }

  /** Deployment block of the manager, found by binary search on contract code */
  private async findStartBlock(): Promise<number> {
    if (config.indexerStartBlock !== undefined) return config.indexerStartBlock;
    const code = await provider.getCode(this.manager);
    if (code === '0x') throw new Error(`No contract at AegisExecutionManager ${this.manager} on this RPC`);
    let lo = 0;
    let hi = this.head;
    try {
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        const c = await provider.getCode(this.manager, mid);
        if (c === '0x') lo = mid + 1;
        else hi = mid;
      }
      return lo;
    } catch {
      // Non-archive RPCs can't read old state; index the recent window instead
      return Math.max(0, this.head - 1000);
    }
  }

  private async timestampOf(blockNumber: number): Promise<string> {
    let ts = this.timestamps.get(blockNumber);
    if (ts === undefined) {
      const block = await provider.getBlock(blockNumber);
      ts = block ? block.timestamp : Math.floor(Date.now() / 1000);
      this.timestamps.set(blockNumber, ts);
      if (this.timestamps.size > 5000) this.timestamps.clear();
    }
    return new Date(ts * 1000).toISOString();
  }

  private agentFor(address: string): IndexedAgent | undefined {
    const a = address.toLowerCase();
    return this.listAgents().find((x) => x.agentAddress.toLowerCase() === a && !x.revoked) ||
      this.listAgents().find((x) => x.agentAddress.toLowerCase() === a);
  }

  private async apply(log: ethers.Log) {
    const isManager = log.address.toLowerCase() === this.manager.toLowerCase();
    let parsed: ethers.LogDescription | null = null;
    try {
      parsed = (isManager ? this.managerIface : this.registryIface).parseLog(log);
    } catch {
      return;
    }
    if (!parsed) return;
    const at = await this.timestampOf(log.blockNumber);
    const a = parsed.args;

    switch (parsed.name) {
      case 'SubnameRegistered': {
        const node = String(a.subnameNode).toLowerCase();
        this.agents.set(node, {
          subnameNode: String(a.subnameNode),
          label: String(a.subname),
          subnameFull: `${a.subname}.${config.rootEnsName}`,
          agentAddress: ethers.getAddress(a.agent),
          ownerAddress: ethers.getAddress(a.owner),
          registeredTxHash: log.transactionHash,
          registeredAt: at,
          revoked: false,
        });
        break;
      }
      case 'SubnameRevoked': {
        const agent = this.agents.get(String(a.subnameNode).toLowerCase());
        if (agent) agent.revoked = true;
        break;
      }
      case 'ExecutionRequested': {
        const id = String(a.requestId).toLowerCase();
        const agentAddress = ethers.getAddress(a.agent);
        const agent = this.agentFor(agentAddress);
        const requiresBiometrics = Boolean(a.requiresBiometrics);
        this.requests.set(id, {
          requestId: String(a.requestId),
          status: requiresBiometrics ? 'PENDING_BIOMETRICS' : 'REQUESTED',
          agentAddress,
          agentSubname: agent ? agent.subnameFull : null,
          ownerAddress: agent ? agent.ownerAddress : null,
          targetContract: ethers.getAddress(a.targetContract),
          valueUSD: parseFloat(ethers.formatEther(a.valueUSD)),
          requiresBiometrics,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          createdAt: at,
          updatedAt: at,
        });
        break;
      }
      case 'ExecutionBiometricsVerified':
        this.patch(a.requestId, { status: 'BIOMETRICS_VERIFIED', verificationTxHash: log.transactionHash, updatedAt: at });
        break;
      case 'ExecutionExecuted':
        this.patch(a.requestId, { status: 'EXECUTED', executionTxHash: log.transactionHash, updatedAt: at });
        break;
      case 'ExecutionCancelled':
        this.patch(a.requestId, { status: 'CANCELLED', cancelTxHash: log.transactionHash, updatedAt: at });
        break;
    }
  }

  private patch(requestId: string, patch: Partial<IndexedRequest>) {
    const rec = this.requests.get(String(requestId).toLowerCase());
    if (rec) Object.assign(rec, patch);
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------
  private load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const snap: Snapshot = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
      // A redeploy means a fresh index
      if (
        snap.version !== 1 ||
        snap.contracts.manager.toLowerCase() !== this.manager.toLowerCase() ||
        snap.contracts.registry.toLowerCase() !== this.registry.toLowerCase()
      ) return;
      this.cursor = snap.cursor;
      snap.requests.forEach((r) => this.requests.set(r.requestId.toLowerCase(), r));
      snap.agents.forEach((g) => this.agents.set(g.subnameNode.toLowerCase(), g));
    } catch (err) {
      console.warn('[indexer] could not load snapshot:', err);
    }
  }

  private save() {
    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
      const snap: Snapshot = {
        version: 1,
        contracts: { manager: this.manager, registry: this.registry },
        cursor: this.cursor,
        requests: [...this.requests.values()],
        agents: [...this.agents.values()],
      };
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(snap));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.warn('[indexer] could not save snapshot:', err);
    }
  }
}

export const indexer = new IndexerService();

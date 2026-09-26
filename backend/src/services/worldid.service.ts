import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';
import { config } from '../config';
import { provider, wallet, getChainId } from '../chain';
import { ManagerABI, RegistryABI } from '../abis';
import { HttpError, requireBytes32, requireUint256 } from '../validate';

const WORLD_ID_VERIFY_URL = 'https://developer.worldcoin.org/api/v2/verify';

/** Same hashing IDKit applies to the signal: keccak256 of the bytes, shifted right 8 bits */
export function hashToField(signal: string): string {
  const bytes = ethers.isHexString(signal) ? ethers.getBytes(signal) : ethers.toUtf8Bytes(signal);
  const hash = BigInt(ethers.keccak256(bytes)) >> 8n;
  return ethers.toBeHex(hash, 32);
}

export interface AttestInput {
  requestId: string;
  proof?: string;
  merkle_root?: string;
  nullifier_hash: string;
  verification_level?: string;
}

/**
 * World ID gate for AegisExecutionManager.verifyBiometricsWithRelayer.
 *
 * 1. Checks the request is real and still waiting onchain.
 * 2. Verifies the IDKit proof with the World ID Developer API (signal = requestId,
 *    so a proof can't be reused for another request).
 * 3. Binds each agent owner to one human: the first verified World ID that approves
 *    for an owner is the only one that can approve for them afterwards.
 * 4. Derives a per-request contract nullifier. World ID returns the same nullifier every
 *    time a person verifies the same action, and the contract marks nullifiers as used,
 *    so passing it through directly would let each human approve exactly one trade ever.
 * 5. Signs the attestation with the relayer key the contract trusts.
 */
export class WorldIDService {
  private manager = new ethers.Contract(config.contracts.AegisExecutionManager, ManagerABI, provider);
  private registry = new ethers.Contract(config.contracts.AegisSubnameRegistry, RegistryABI, provider);
  private bindingsFile = path.join(config.dataDir, 'worldid-bindings.json');
  private bindings: Record<string, { nullifierHash: string; boundAt: string }> = {};

  constructor() {
    try {
      if (fs.existsSync(this.bindingsFile)) this.bindings = JSON.parse(fs.readFileSync(this.bindingsFile, 'utf-8'));
    } catch (err) {
      console.warn('Could not load World ID bindings:', err);
    }
  }

  private saveBindings() {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${this.bindingsFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.bindings, null, 2));
    fs.renameSync(tmp, this.bindingsFile);
  }

  bindingFor(owner: string) {
    return this.bindings[owner.toLowerCase()] || null;
  }

  /** Public widget settings for the browser */
  widgetConfig() {
    return {
      appId: config.worldIdAppId,
      action: config.worldIdAction,
      verificationLevel: config.worldIdVerificationLevel,
      mode: config.worldIdVerifyMode,
    };
  }

  private async verifyWithWorld(input: AttestInput): Promise<void> {
    if (config.worldIdVerifyMode === 'dev') return; // local testing only

    if (!input.proof || !input.merkle_root) {
      throw new HttpError(400, 'proof and merkle_root from the World ID widget are required');
    }
    let res: Response;
    try {
      res = await fetch(`${WORLD_ID_VERIFY_URL}/${config.worldIdAppId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nullifier_hash: input.nullifier_hash,
          merkle_root: input.merkle_root,
          proof: input.proof,
          verification_level: input.verification_level || config.worldIdVerificationLevel,
          action: config.worldIdAction,
          signal_hash: hashToField(input.requestId),
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err: any) {
      throw new HttpError(502, `Could not reach the World ID API: ${err.message}`);
    }
    if (!res.ok) {
      const body: any = await res.json().catch(() => ({}));
      const reason = body.detail || body.code || `World ID API returned ${res.status}`;
      throw new HttpError(401, `World ID rejected the proof: ${reason}`);
    }
  }

  async attest(input: AttestInput) {
    const requestId = requireBytes32(input.requestId, 'requestId');
    const worldNullifier = requireUint256(input.nullifier_hash, 'nullifier_hash');

    // 1. Request must exist onchain and still be waiting
    const req = await this.manager.executionRequests(requestId);
    if (req.requestId === ethers.ZeroHash) throw new HttpError(404, 'No such request on AegisExecutionManager');
    if (req.isExecuted) throw new HttpError(409, 'This request has already executed');
    if (req.isCancelled) throw new HttpError(409, 'This request was cancelled');
    if (req.isVerified) throw new HttpError(409, 'This request is already approved; just execute it');

    const node: string = await this.registry.agentToNode(req.agentAddress);
    if (node === ethers.ZeroHash) throw new HttpError(409, 'The agent behind this request is no longer registered');
    const perm = await this.registry.getAgentPermissions(node);
    const owner: string = ethers.getAddress(perm.ownerAddress);
    if (!perm.isActive) throw new HttpError(409, 'The agent behind this request has been revoked');

    // The daily limit is enforced when the trade executes; don't let the owner approve a trade
    // that is certain to revert
    const limit: bigint = perm.dailySpendingLimit;
    if (limit > 0n) {
      const windowExpired = BigInt(Math.floor(Date.now() / 1000)) >= BigInt(perm.lastSpentTimestamp) + 86400n;
      const spent: bigint = windowExpired ? 0n : perm.currentDailySpent;
      if (spent + req.valueUSD > limit) {
        const left = limit > spent ? limit - spent : 0n;
        throw new HttpError(
          409,
          `This trade would exceed the agent's daily limit ($${Number(ethers.formatEther(left)).toLocaleString('en-US')} left today), so execution would revert. Cancel it instead.`
        );
      }
    }

    // 2. Real proof check
    await this.verifyWithWorld({ ...input, requestId });

    // 3. One human per owner
    const worldNullifierHex = ethers.toBeHex(worldNullifier, 32);
    const existing = this.bindingFor(owner);
    if (existing && existing.nullifierHash !== worldNullifierHex) {
      throw new HttpError(403, `Approvals for ${owner} are bound to a different World ID. Only the owner's verified human can approve.`);
    }

    // 4. Per-request nullifier for the contract's replay protection
    const contractNullifier = BigInt(
      ethers.solidityPackedKeccak256(['uint256', 'bytes32'], [worldNullifier, requestId])
    );
    if (await this.manager.usedNullifiers(contractNullifier)) {
      throw new HttpError(409, 'This approval was already used onchain');
    }

    // 5. Relayer signature over (requestId, nullifier, manager, chainId)
    const chainId = await getChainId();
    if (chainId === null) throw new HttpError(503, 'RPC unavailable; try again shortly');
    const messageHash = ethers.solidityPackedKeccak256(
      ['bytes32', 'uint256', 'address', 'uint256'],
      [requestId, contractNullifier, config.contracts.AegisExecutionManager, chainId]
    );
    const signature = await wallet.signMessage(ethers.getBytes(messageHash));

    const newlyBound = !existing;
    if (newlyBound) {
      this.bindings[owner.toLowerCase()] = { nullifierHash: worldNullifierHex, boundAt: new Date().toISOString() };
      this.saveBindings();
    }

    return {
      requestId,
      nullifierHash: contractNullifier.toString(),
      signature,
      relayer: wallet.address,
      owner,
      humanBound: true,
      newlyBound,
      verifyMode: config.worldIdVerifyMode,
    };
  }
}

export const worldIdService = new WorldIDService();

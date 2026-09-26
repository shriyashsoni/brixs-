// End-to-end test of the real browser flow, run against a local Hardhat chain.
// A user wallet (Hardhat account #1) does exactly what frontend/chain.js does in the browser:
// register → AI plan → trade → World ID attestation → approve → execute → cancel → revoke.
//
// Usage (see README → Testing):
//   1. cd contracts && npx hardhat node          (terminal 1)
//   2. cd contracts && npm run deploy            (restores nothing: back up config files first)
//   3. start the backend on :4200 against the local chain with WORLD_ID_VERIFY_MODE=dev
//   4. cd backend && npm run test:e2e
const { ethers } = require('ethers');
const API = process.env.API_URL || 'http://localhost:4200';
const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
const user = new ethers.NonceManager(new ethers.Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', provider));
const stranger = new ethers.Wallet('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', provider);

const call = async (path, body) => {
  const r = await fetch(API + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json();
  return { status: r.status, ...j };
};
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) process.exitCode = 1; };
const reason = (e) => e.reason || e.shortMessage || e.message;

(async () => {
  const health = await call('/api/health');
  const abis = await call('/api/abis');
  const c = health.contracts;
  const registry = new ethers.Contract(c.AegisSubnameRegistry, abis.registry, user);
  const manager = new ethers.Contract(c.AegisExecutionManager, abis.manager, user);
  const me = await user.getAddress();
  const usd = (n) => ethers.parseEther(n.toFixed(6));
  const parse = (contract, receipt, name) => receipt.logs.map((l) => { try { return contract.interface.parseLog(l); } catch { return null; } }).find((p) => p && p.name === name);

  console.log('1. Register agent from the user wallet (3 txs)');
  const r1 = await (await registry.registerSubname('judge1', me, usd(1000), usd(50000))).wait();
  const node = parse(registry, r1, 'SubnameRegistered').args.subnameNode;
  await (await registry.setTargetContractWhitelist(node, c.AegisSwapVMAdapter, true)).wait();
  await (await registry.setTargetContractWhitelist(node, c.AegisUniswapV4Hook, true)).wait();
  const perm = await call('/api/ens/permissions/' + me);
  ok(perm.permissions && perm.permissions.ownerAddress === me, 'owner is the user wallet, not the backend: ' + perm.permissions.subnameFull);

  async function trade(amount, goal) {
    const p = await call('/api/agent/propose', { agentAddress: me, amountUSD: amount, goalPrompt: goal });
    if (!p.success) throw new Error(p.error);
    const receipt = await (await manager.requestExecution(p.targetContract, p.encodedCallData, usd(amount))).wait();
    const ev = parse(manager, receipt, 'ExecutionRequested');
    return { requestId: ev.args.requestId, bio: ev.args.requiresBiometrics, executed: !!parse(manager, receipt, 'ExecutionExecuted'), proposal: p.proposal };
  }

  console.log('2. $250 trade signed by the agent wallet');
  const t1 = await trade(250, 'Rebalance the treasury: swap USDC to ETH');
  ok(!t1.bio && t1.executed, 'executed in the same tx, no approval needed (planner: ' + t1.proposal.planner + ', ' + t1.proposal.strategyType + ')');

  console.log('3. $2,500 trade pauses, World ID attestation, owner approves + executes');
  const t2 = await trade(2500, 'Split swap USDC to ETH for the best price');
  ok(t2.bio && !t2.executed, 'paused onchain waiting for biometrics');
  const worldNullifier = '0x' + '11'.repeat(31);
  const att = await call('/api/worldid/attest', { requestId: t2.requestId, nullifier_hash: worldNullifier });
  ok(att.success && att.signature, 'backend attested; owner bound to this human: ' + att.newlyBound);
  await (await manager.verifyBiometricsWithRelayer(t2.requestId, BigInt(att.nullifierHash), att.signature)).wait();
  const ex = await (await manager.executeVerifiedTransaction(t2.requestId)).wait();
  ok(!!parse(manager, ex, 'ExecutionExecuted'), 'executed after approval');
  const again = await call('/api/worldid/attest', { requestId: t2.requestId, nullifier_hash: worldNullifier });
  ok(again.status === 409, 'second attestation for the same request rejected: ' + again.error);

  console.log('4. Same human approves another trade (per-request nullifier)');
  const t3 = await trade(5000, 'Swap USDC to ETH');
  const att3 = await call('/api/worldid/attest', { requestId: t3.requestId, nullifier_hash: worldNullifier });
  ok(att3.success, 'same World ID can approve a new request');
  const other = await call('/api/worldid/attest', { requestId: t3.requestId, nullifier_hash: '0x' + '22'.repeat(31) });
  ok(other.status === 403, 'a different human is refused for this owner: ' + other.error);

  console.log('5. Owner cancels a pending trade; stranger cannot');
  try {
    await (await manager.connect(stranger).cancelExecution(t3.requestId)).wait();
    ok(false, 'stranger cancel should revert');
  } catch (e) { ok(/unauthorized cancel/.test(reason(e)), 'stranger blocked: ' + reason(e)); }
  await (await manager.cancelExecution(t3.requestId)).wait();
  const att4 = await call('/api/worldid/attest', { requestId: t3.requestId, nullifier_hash: worldNullifier });
  ok(att4.status === 409, 'cancelled request cannot be approved: ' + att4.error);

  console.log('6. Guardrails enforced onchain');
  const p = await call('/api/agent/propose', { agentAddress: me, amountUSD: 60000 });
  ok(p.proposal.dailyLimit && p.proposal.dailyLimit.exceeds, 'plan flags the $60,000 trade as over the $50,000 daily limit');
  // A bot that ignores the warning can still queue it onchain, but it can never be approved
  const over = await (await manager.requestExecution(p.targetContract, p.encodedCallData, usd(60000))).wait();
  const overId = parse(manager, over, 'ExecutionRequested').args.requestId;
  const attOver = await call('/api/worldid/attest', { requestId: overId, nullifier_hash: worldNullifier });
  ok(attOver.status === 409, 'World ID approval refused: ' + attOver.error);
  const ps = await call('/api/agent/propose', { agentAddress: stranger.address, amountUSD: 100 });
  try { await (await manager.connect(stranger).requestExecution(ps.targetContract, ps.encodedCallData, usd(100))).wait(); ok(false, 'unregistered agent should revert'); }
  catch (e) { ok(true, 'unregistered agent blocked: ' + reason(e)); }

  console.log('7. Indexer shows the real history');
  await call('/api/execution/refresh', {});
  const list = await call('/api/execution/requests?agent=' + me);
  ok(list.requests.length === 4, 'indexed ' + list.requests.length + ' requests: ' + list.requests.map((r) => r.valueUSD + ':' + r.status).join(', '));
  ok(list.requests.every((r) => r.agentSubname === 'judge1.aegisnet.eth' && r.ownerAddress === me), 'requests carry ENS name and owner');
  const agents = await call('/api/ens/agents?owner=' + me);
  ok(agents.agents.length === 1 && agents.agents[0].subnameFull === 'judge1.aegisnet.eth', 'agents by owner from chain events');

  console.log('8. Revoke from the owner wallet');
  await (await registry.revokeSubname(node)).wait();
  const gone = await call('/api/ens/permissions/' + me);
  ok(gone.status === 404, 'revoked agent has no identity');

  console.log(process.exitCode ? '\nFAILED' : '\nALL PASSED');
})().catch((e) => { console.error('ERROR', reason(e)); process.exit(1); });

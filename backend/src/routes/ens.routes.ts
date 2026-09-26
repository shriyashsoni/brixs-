import { Router } from 'express';
import { ENSService } from '../services/ens.service';
import { HttpError, route, requireAddress, requireBytes32, requireString, requireUsd } from '../validate';
import { adminOnly } from '../middleware';
import { indexer } from '../services/indexer.service';

const router = Router();
const ensService = new ENSService();

/**
 * POST /api/ens/register-subname
 * Register an agent subname (e.g. agent1.aegisnet.eth) with Enhanced Access Control (EAC)
 */
router.post(
  '/register-subname',
  adminOnly,
  route(async (req, res) => {
    const label = requireString(req.body.label, 'label', { max: 63, pattern: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/ });
    const agentAddress = requireAddress(req.body.agentAddress, 'agentAddress');
    const threshold = requireUsd(req.body.biometricThresholdUSD, 'biometricThresholdUSD', { optional: true });
    const dailyLimit = requireUsd(req.body.dailySpendingLimitUSD, 'dailySpendingLimitUSD', { optional: true });

    const existing = await ensService.getAgentPermissionsByAddress(agentAddress);
    if (existing?.isActive) {
      throw new HttpError(409, `${agentAddress} is already registered as ${existing.subnameFull}`);
    }

    const result = await ensService.registerAgentSubname(label, agentAddress, threshold, dailyLimit);
    res.json({ success: true, data: result });
  })
);

/**
 * GET /api/ens/permissions/:agentAddress
 * Retrieve EAC agent permissions and World ID threshold settings
 */
router.get(
  '/permissions/:agentAddress',
  route(async (req, res) => {
    const agentAddress = requireAddress(req.params.agentAddress, 'agentAddress');
    const permissions = await ensService.getAgentPermissionsByAddress(agentAddress);
    if (!permissions) throw new HttpError(404, 'No registered subname found for this agent address');
    res.json({ success: true, permissions });
  })
);

/**
 * GET /api/ens/whitelist/:subnameNode/:targetContract
 * Check whether a target contract is whitelisted for a subname
 */
router.get(
  '/whitelist/:subnameNode/:targetContract',
  route(async (req, res) => {
    const subnameNode = requireBytes32(req.params.subnameNode, 'subnameNode');
    const targetContract = requireAddress(req.params.targetContract, 'targetContract');
    const isWhitelisted = await ensService.isTargetWhitelisted(subnameNode, targetContract);
    res.json({ success: true, subnameNode, targetContract, isWhitelisted });
  })
);

/**
 * POST /api/ens/whitelist-target
 * Update Enhanced Access Control (EAC) target contract whitelist
 */
router.post(
  '/whitelist-target',
  adminOnly,
  route(async (req, res) => {
    const subnameNode = requireBytes32(req.body.subnameNode, 'subnameNode');
    const targetContract = requireAddress(req.body.targetContract, 'targetContract');
    const txHash = await ensService.setTargetContractWhitelist(subnameNode, targetContract, req.body.isWhitelisted !== false && req.body.isWhitelisted !== 'false');
    res.json({ success: true, txHash });
  })
);

/**
 * POST /api/ens/threshold
 * Update the World ID biometric threshold for a subname
 */
router.post(
  '/threshold',
  adminOnly,
  route(async (req, res) => {
    const subnameNode = requireBytes32(req.body.subnameNode, 'subnameNode');
    const thresholdUSD = requireUsd(req.body.thresholdUSD, 'thresholdUSD')!;
    const txHash = await ensService.updateBiometricThreshold(subnameNode, thresholdUSD);
    res.json({ success: true, txHash });
  })
);

/**
 * POST /api/ens/revoke
 * Revoke an agent subname; the agent immediately loses all authority
 */
router.post(
  '/revoke',
  adminOnly,
  route(async (req, res) => {
    const subnameNode = requireBytes32(req.body.subnameNode, 'subnameNode');
    const txHash = await ensService.revokeSubname(subnameNode);
    res.json({ success: true, txHash });
  })
);

/**
 * POST /api/ens/text-record
 * Set ENSIP-26 Agent Text Record (e.g., agent.capabilities, agent.biometric_threshold)
 */
router.post(
  '/text-record',
  adminOnly,
  route(async (req, res) => {
    const subnameNode = requireBytes32(req.body.subnameNode, 'subnameNode');
    const key = requireString(req.body.key, 'key', { max: 128 });
    if (req.body.value === undefined || req.body.value === null) throw new HttpError(400, 'value is required');
    const value = String(req.body.value).slice(0, 2048);

    const txHash = await ensService.setTextRecord(subnameNode, key, value);
    res.json({ success: true, txHash });
  })
);

/**
 * GET /api/ens/text-record/:subnameNode/:key
 * Resolve ENSIP-26 Agent Text Record
 */
router.get(
  '/text-record/:subnameNode/:key',
  route(async (req, res) => {
    const subnameNode = requireBytes32(req.params.subnameNode, 'subnameNode');
    const key = requireString(req.params.key, 'key', { max: 128 });
    const value = await ensService.getTextRecord(subnameNode, key);
    res.json({ success: true, key, value });
  })
);

/**
 * GET /api/ens/agents?owner=0x…&agent=0x…
 * Agents registered on AegisSubnameRegistry, read from chain events
 */
router.get('/agents', (req, res) => {
  const owner = req.query.owner ? requireAddress(req.query.owner, 'owner') : undefined;
  const agent = req.query.agent ? requireAddress(req.query.agent, 'agent') : undefined;
  const agents = indexer.listAgents({ owner, agent });
  res.json({ success: true, count: agents.length, agents });
});

export default router;

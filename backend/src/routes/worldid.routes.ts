import { Router } from 'express';
import { worldIdService } from '../services/worldid.service';
import { indexer } from '../services/indexer.service';
import { rateLimit } from '../middleware';
import { requireAddress, requireString, route } from '../validate';

const router = Router();

/**
 * GET /api/worldid/config
 * Settings for the World ID (IDKit) widget in the browser
 */
router.get('/config', (_req, res) => {
  res.json({ success: true, ...worldIdService.widgetConfig() });
});

/**
 * GET /api/worldid/binding/:owner
 * Whether an owner already has a verified human bound to their agents
 */
router.get('/binding/:owner', (req, res) => {
  const owner = requireAddress(req.params.owner, 'owner');
  const binding = worldIdService.bindingFor(owner);
  res.json({ success: true, owner, bound: !!binding, boundAt: binding?.boundAt || null });
});

/**
 * POST /api/worldid/attest
 * Body: IDKit success result + requestId. Verifies the proof with World ID and returns the
 * relayer attestation the owner's wallet submits to verifyBiometricsWithRelayer.
 */
router.post(
  '/attest',
  rateLimit('World ID', 10, 60_000),
  route(async (req, res) => {
    const result = await worldIdService.attest({
      requestId: requireString(req.body.requestId, 'requestId', { max: 80 }),
      nullifier_hash: requireString(req.body.nullifier_hash, 'nullifier_hash', { max: 80 }),
      merkle_root: typeof req.body.merkle_root === 'string' ? req.body.merkle_root : undefined,
      proof: typeof req.body.proof === 'string' ? req.body.proof : undefined,
      verification_level: typeof req.body.verification_level === 'string' ? req.body.verification_level : undefined,
    });
    indexer.refresh().catch(() => undefined);
    res.json({ success: true, ...result });
  })
);

export default router;

import { Router } from 'express';
import { UniswapService } from '../services/uniswap.service';
import { route, requireString } from '../validate';
import { adminOnly } from '../middleware';

const router = Router();
const uniswapService = new UniswapService();

/**
 * GET /api/uniswap/pools/:poolId
 * Whether a Uniswap v4 pool is gated by the AegisNet beforeSwap hook.
 * poolId may be a bytes32 pool ID or a label (hashed with keccak256).
 */
router.get(
  '/pools/:poolId',
  route(async (req, res) => {
    const label = requireString(req.params.poolId, 'poolId', { max: 128 });
    const isGated = await uniswapService.isPoolGated(label);
    res.json({ success: true, poolId: UniswapService.toPoolId(label), label, isGated });
  })
);

/**
 * POST /api/uniswap/pools/gate
 * Turn agent-only gating on or off for a pool (hook owner only)
 */
router.post(
  '/pools/gate',
  adminOnly,
  route(async (req, res) => {
    const label = requireString(req.body.poolId, 'poolId', { max: 128 });
    const isGated = req.body.isGated !== false && req.body.isGated !== 'false';
    const txHash = await uniswapService.setPoolGated(label, isGated);
    res.json({ success: true, poolId: UniswapService.toPoolId(label), isGated, txHash });
  })
);

export default router;

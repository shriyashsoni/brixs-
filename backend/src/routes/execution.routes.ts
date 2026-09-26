import { Router } from 'express';
import { ethers } from 'ethers';
import { indexer } from '../services/indexer.service';
import { executionService } from '../services/execution.service';
import { adminOnly } from '../middleware';
import { HttpError, requireAddress, requireBytes32, route } from '../validate';

const router = Router();

/**
 * GET /api/execution/requests?agent=0x…&owner=0x…
 * Every request on AegisExecutionManager, read from chain events (newest first)
 */
router.get('/requests', (req, res) => {
  const agent = req.query.agent ? requireAddress(req.query.agent, 'agent') : undefined;
  const owner = req.query.owner ? requireAddress(req.query.owner, 'owner') : undefined;
  const requests = indexer.listRequests({ agent, owner });
  res.json({ success: true, count: requests.length, indexer: indexer.status(), requests });
});

/**
 * POST /api/execution/refresh
 * Index the latest blocks now (the console calls this right after a user transaction)
 */
router.post(
  '/refresh',
  route(async (_req, res) => {
    await indexer.refresh();
    res.json({ success: true, indexer: indexer.status() });
  })
);

/**
 * GET /api/execution/:requestId
 */
router.get('/:requestId', (req, res) => {
  const requestId = requireBytes32(req.params.requestId, 'requestId');
  const status = indexer.getRequest(requestId);
  if (!status) throw new HttpError(404, 'Request not found (it may not be indexed yet)');
  res.json({ success: true, status });
});

/**
 * POST /api/execution/:requestId/execute  (admin)
 * Backend wallet submits executeVerifiedTransaction for an approved request
 */
router.post(
  '/:requestId/execute',
  adminOnly,
  route(async (req, res) => {
    const requestId = requireBytes32(req.params.requestId, 'requestId');
    res.json({ success: true, ...(await executionService.executeVerified(requestId)) });
  })
);

/**
 * POST /api/execution/:requestId/cancel  (admin)
 * Only works when the backend wallet is the agent, owner or protocol owner
 */
router.post(
  '/:requestId/cancel',
  adminOnly,
  route(async (req, res) => {
    const requestId = requireBytes32(req.params.requestId, 'requestId');
    if (requestId === ethers.ZeroHash) throw new HttpError(400, 'Invalid requestId');
    res.json({ success: true, ...(await executionService.cancel(requestId)) });
  })
);

export default router;

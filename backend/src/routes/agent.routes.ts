import { Router } from 'express';
import { AIAgentService } from '../services/aiAgent.service';
import { executionService } from '../services/execution.service';
import { adminOnly, rateLimit } from '../middleware';
import { route, requireAddress, requireUsd } from '../validate';

const router = Router();
const aiAgentService = new AIAgentService();

const optionalSymbol = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 10) : undefined);
const goalOf = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 1000) : fallback);

/**
 * POST /api/agent/propose
 * Plan a strategy (Claude when configured) and return the encoded calldata the agent's
 * wallet submits to AegisExecutionManager.requestExecution. Nothing is sent onchain here.
 */
router.post(
  '/propose',
  rateLimit('strategy', 20, 60_000),
  route(async (req, res) => {
    const agentAddress = requireAddress(req.body.agentAddress, 'agentAddress');
    const amountUSD = requireUsd(req.body.amountUSD, 'amountUSD', { min: 0.01 })!;

    const proposal = await aiAgentService.evaluateAndProposeStrategy(
      agentAddress,
      goalOf(req.body.goalPrompt, 'Swap USDC to ETH at the best price'),
      amountUSD,
      { tokenInSymbol: optionalSymbol(req.body.tokenInSymbol), tokenOutSymbol: optionalSymbol(req.body.tokenOutSymbol) }
    );

    res.json({ success: true, ...proposal });
  })
);

/**
 * POST /api/agent/execute  (admin)
 * Bot path: the backend wallet is the agent and submits requestExecution itself.
 */
router.post(
  '/execute',
  adminOnly,
  route(async (req, res) => {
    const agentAddress = requireAddress(req.body.agentAddress, 'agentAddress');
    const amountUSD = requireUsd(req.body.amountUSD, 'amountUSD', { min: 0.01 })!;

    const result = await executionService.processAgentRequest(
      agentAddress,
      goalOf(req.body.goalPrompt, 'Swap USDC to ETH at the best price'),
      amountUSD,
      { tokenInSymbol: optionalSymbol(req.body.tokenInSymbol), tokenOutSymbol: optionalSymbol(req.body.tokenOutSymbol) }
    );

    res.json({ success: true, ...result });
  })
);

export default router;

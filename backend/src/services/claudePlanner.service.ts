import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { config } from '../config';

export const TOKEN_SYMBOLS = ['USDC', 'USDT', 'DAI', 'WETH', 'WBTC'] as const;

const PlanSchema = z.object({
  strategyType: z.enum(['swap', 'split_swap', 'aqua_position']),
  tokenIn: z.enum(TOKEN_SYMBOLS),
  tokenOut: z.enum(TOKEN_SYMBOLS),
  useUniswapV4Hop: z.boolean(),
  summary: z.string(),
  rationale: z.array(z.string()),
  riskNotes: z.array(z.string()),
});

export type ClaudePlan = z.infer<typeof PlanSchema>;

export interface PlannerContext {
  goalPrompt: string;
  amountUSD: number;
  tokenInSymbol?: string;
  tokenOutSymbol?: string;
  approvalThresholdUSD: number;
  dailyLimitUSD?: number;
  spentTodayUSD?: number;
}

const SYSTEM_PROMPT = `You are the strategy planner for AegisNet, a guardrailed execution layer for AI trading agents on Ethereum.

Turn the operator's goal into a plan for the 1inch SwapVM adapter. You only choose the plan; deterministic code builds and encodes the transaction from your choice, and onchain rules enforce limits.

Available strategy types:
- "swap": one direct 1inch aggregator swap (opcode 0x01), then a minimum-output slippage check (0x03).
- "split_swap": split the order across liquidity sources for better pricing on larger orders (0x02), then the slippage check.
- "aqua_position": deposit into a 1inch Aqua self-custodial liquidity position and rebalance it (0x05, 0x06). Use for yield, liquidity or "earn" goals.

useUniswapV4Hop adds a hop through the agent-gated Uniswap v4 hook (0x04), whose beforeSwap check verifies the agent's ENS permissions. Enable it for swaps unless the operator asks to avoid Uniswap. It does not apply to aqua_position.

Supported tokens: USDC, USDT, DAI, WETH, WBTC (use WETH for ETH, WBTC for BTC). tokenIn and tokenOut must differ. If the operator fixed a token, keep it.

Write "summary" as one plain-English sentence a non-technical judge understands. Keep each rationale item and risk note to one short sentence. In riskNotes, mention when the trade will pause for the owner's World ID approval because it is at or above the approval threshold, and when it would exceed the remaining daily limit.`;

/**
 * Claude-backed planner. Returns null (caller falls back to deterministic rules) when no API
 * key is configured, the request fails, or the model declines.
 */
export class ClaudePlanner {
  private client = config.anthropicApiKey
    ? new Anthropic({ apiKey: config.anthropicApiKey, timeout: 45_000, maxRetries: 1 })
    : null;

  get enabled() {
    return this.client !== null;
  }

  get model() {
    return config.claudeModel;
  }

  async plan(ctx: PlannerContext): Promise<ClaudePlan | null> {
    if (!this.client) return null;

    const remaining =
      ctx.dailyLimitUSD !== undefined ? Math.max(0, ctx.dailyLimitUSD - (ctx.spentTodayUSD || 0)) : undefined;
    const facts = [
      `Goal: ${ctx.goalPrompt}`,
      `Trade size: $${ctx.amountUSD.toLocaleString('en-US')}`,
      `Approval threshold (World ID required at or above): $${ctx.approvalThresholdUSD.toLocaleString('en-US')}`,
      remaining !== undefined ? `Remaining daily limit: $${remaining.toLocaleString('en-US')}` : 'Daily limit: unknown (agent not registered yet)',
      ctx.tokenInSymbol ? `Operator fixed tokenIn: ${ctx.tokenInSymbol}` : '',
      ctx.tokenOutSymbol ? `Operator fixed tokenOut: ${ctx.tokenOutSymbol}` : '',
    ].filter(Boolean);

    try {
      const response = await this.client.beta.messages.parse({
        model: config.claudeModel,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low', format: betaZodOutputFormat(PlanSchema) },
        // Re-run declined requests on Anthropic's recommended fallback model
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: facts.join('\n') }],
      });

      if (response.stop_reason === 'refusal') {
        console.warn('[claude] planner declined:', response.stop_details?.category ?? 'unknown');
        return null;
      }
      if (response.stop_reason === 'max_tokens') {
        console.warn('[claude] planner hit max_tokens');
        return null;
      }
      const plan = response.parsed_output;
      if (!plan || plan.tokenIn === plan.tokenOut) return null;
      return plan;
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        console.warn('[claude] invalid ANTHROPIC_API_KEY; using rule-based planner');
      } else if (err instanceof Anthropic.RateLimitError) {
        console.warn('[claude] rate limited; using rule-based planner');
      } else if (err instanceof Anthropic.APIError) {
        console.warn(`[claude] API error ${err.status}: ${err.message}`);
      } else {
        console.warn('[claude] planner failed:', (err as Error).message);
      }
      return null;
    }
  }
}

export const claudePlanner = new ClaudePlanner();

import { ethers } from 'ethers';
import { SwapVMService } from './swapvm.service';
import { ENSService } from './ens.service';
import { StrategyType, TradeStrategyProposal } from '../types';
import { config } from '../config';
import { isRpcUnavailable } from '../chain';
import { HttpError } from '../validate';
import { claudePlanner } from './claudePlanner.service';

/** Ethereum mainnet token addresses (used for encoding and 1inch quotes) */
export const TOKENS: Record<string, { address: string; decimals: number; stable: boolean }> = {
  USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, stable: true },
  USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, stable: true },
  DAI: { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18, stable: true },
  WETH: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18, stable: false },
  WBTC: { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8, stable: false },
};
const SYMBOL_ALIASES: Record<string, string> = { ETH: 'WETH', BTC: 'WBTC' };

// Rough fallback rates (tokens per 1 USD) used only when no 1inch quote is available
const STATIC_RATES: Record<string, number> = { USDC: 1, USDT: 1, DAI: 1, WETH: 0.00032, WBTC: 0.000016 };

export function normalizeSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  return SYMBOL_ALIASES[s] || s;
}

export interface StrategyOptions {
  tokenInSymbol?: string;
  tokenOutSymbol?: string;
}

export class AIAgentService {
  private swapVMService = new SwapVMService();
  private ensService = new ENSService();

  /**
   * Rule-based goal interpreter: picks the strategy type, token pair and route shape from the prompt.
   */
  interpretGoal(goalPrompt: string, opts: StrategyOptions) {
    const goal = goalPrompt.toLowerCase();
    const rationale: string[] = [];

    const mentioned = (goalPrompt.toUpperCase().match(/\b(USDC|USDT|DAI|WETH|ETH|WBTC|BTC)\b/g) || []).map(normalizeSymbol);
    const tokenIn = normalizeSymbol(opts.tokenInSymbol || mentioned[0] || 'USDC');
    const tokenOut = normalizeSymbol(opts.tokenOutSymbol || mentioned.find((s) => s !== tokenIn) || (tokenIn === 'WETH' ? 'USDC' : 'WETH'));

    for (const sym of [tokenIn, tokenOut]) {
      if (!TOKENS[sym]) throw new HttpError(400, `Unsupported token ${sym}. Supported: ${Object.keys(TOKENS).join(', ')}`);
    }
    if (tokenIn === tokenOut) throw new HttpError(400, 'tokenIn and tokenOut must differ');

    let strategyType: StrategyType = 'swap';
    if (/\b(aqua|yield|deposit|liquidity|lp|farm|earn)\b/.test(goal)) {
      strategyType = 'aqua_position';
      rationale.push('Goal mentions yield/liquidity → 1inch Aqua deposit + rebalance (0x05, 0x06).');
    } else if (/\b(split|best price|large|minimi[sz]e slippage)\b/.test(goal)) {
      strategyType = 'split_swap';
      rationale.push('Goal asks for price efficiency → split route across sources (0x02).');
    } else {
      rationale.push('Direct 1inch aggregator swap (0x01).');
    }

    const useUniswapV4Hop = strategyType !== 'aqua_position' && !/\b(no|without|skip)\s+uniswap\b|1inch only/.test(goal);
    if (useUniswapV4Hop) rationale.push('Adds agent-gated Uniswap v4 hop (0x04) so the hook enforces ENS permissions.');
    if (strategyType !== 'aqua_position') rationale.push('Ends with a minimum-output slippage check (0x03).');

    return { strategyType, tokenIn, tokenOut, useUniswapV4Hop, rationale };
  }

  /** Real 1inch quote when an API key is configured and tokenIn is a stablecoin (so amountUSD = token amount) */
  private async quote(tokenIn: string, tokenOut: string, amountUSD: number): Promise<{ output: string; source: TradeStrategyProposal['quoteSource'] }> {
    const from = TOKENS[tokenIn];
    const to = TOKENS[tokenOut];

    if (config.oneInchApiKey && from.stable) {
      try {
        const amount = ethers.parseUnits(amountUSD.toFixed(from.decimals > 6 ? 6 : from.decimals), from.decimals);
        const url = `https://api.1inch.dev/swap/v6.0/1/quote?src=${from.address}&dst=${to.address}&amount=${amount}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${config.oneInchApiKey}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const body: any = await res.json();
          if (body.dstAmount) {
            return { output: Number(ethers.formatUnits(body.dstAmount, to.decimals)).toFixed(6), source: '1inch_api' };
          }
        } else {
          console.warn(`1inch quote failed (${res.status}); using static estimate`);
        }
      } catch (err: any) {
        console.warn('1inch quote error; using static estimate:', err.message);
      }
    }

    // amountUSD is the trade's USD value whatever tokenIn is, so only the output rate matters
    const output = amountUSD * STATIC_RATES[tokenOut] * 0.995;
    return { output: output.toFixed(6), source: 'static_estimate' };
  }

  /**
   * Evaluates the goal and formulates a SwapVM route for the agent
   */
  async evaluateAndProposeStrategy(
    agentAddress: string,
    goalPrompt: string,
    amountUSD: number,
    opts: StrategyOptions = {}
  ): Promise<{ proposal: TradeStrategyProposal; encodedCallData: string; targetContract: string }> {
    const targetContract = config.contracts.AegisSwapVMAdapter;
    const checks: string[] = [];

    // Identity + onchain authorization first, so the planner knows the agent's real limits
    let permissions = null;
    let authorization: TradeStrategyProposal['authorization'] = null;
    try {
      permissions = await this.ensService.getAgentPermissionsByAddress(agentAddress);
      if (permissions) {
        const auth = await this.ensService.verifyAgentAuthorization(agentAddress, targetContract, amountUSD);
        authorization = { isAllowed: auth.isAllowed, requiresBiometrics: auth.requiresBiometrics };
        if (!auth.isAllowed) checks.push('⚠ Onchain check: agent is inactive or the SwapVM adapter is not whitelisted.');
      } else {
        checks.push('⚠ This address has no ENS agent identity yet. Register it before executing.');
      }
    } catch (err) {
      if (!isRpcUnavailable(err)) throw err;
      checks.push('⚠ RPC unavailable; permissions not checked.');
    }

    let dailyLimit: TradeStrategyProposal['dailyLimit'] = null;
    if (permissions) {
      const limitUSD = permissions.dailySpendingLimitUSD;
      const spentTodayUSD = permissions.currentDailySpentUSD;
      // A limit of 0 means unlimited in AegisSubnameRegistry.recordSpend
      const remainingUSD = limitUSD > 0 ? Math.max(0, limitUSD - spentTodayUSD) : null;
      const exceeds = remainingUSD !== null && amountUSD > remainingUSD;
      dailyLimit = { limitUSD, spentTodayUSD, remainingUSD, exceeds };
      if (exceeds) {
        checks.push(`⚠ Over the daily limit: only $${remainingUSD!.toLocaleString('en-US')} of $${limitUSD.toLocaleString('en-US')} left today. The contract would reject it at execution.`);
      }
    }

    const agentSubname = permissions ? permissions.subnameFull : null;
    const thresholdUSD = permissions ? permissions.biometricThresholdUSD : config.biometricDefaultThresholdUSD;
    const requiresBiometrics = authorization ? authorization.requiresBiometrics : thresholdUSD > 0 && amountUSD >= thresholdUSD;

    // Claude plans when configured; deterministic rules otherwise. Either way the code below
    // builds the calldata, so the model can never produce arbitrary transactions.
    const forcedIn = opts.tokenInSymbol ? normalizeSymbol(opts.tokenInSymbol) : undefined;
    const forcedOut = opts.tokenOutSymbol ? normalizeSymbol(opts.tokenOutSymbol) : undefined;
    const aiPlan = await claudePlanner.plan({
      goalPrompt,
      amountUSD,
      tokenInSymbol: forcedIn,
      tokenOutSymbol: forcedOut,
      approvalThresholdUSD: thresholdUSD,
      dailyLimitUSD: permissions?.dailySpendingLimitUSD,
      spentTodayUSD: permissions?.currentDailySpentUSD,
    });

    let strategyType: StrategyType;
    let tokenIn: string;
    let tokenOut: string;
    let useUniswapV4Hop: boolean;
    let rationale: string[];
    let summary: string;
    let riskNotes: string[] = [];

    if (aiPlan) {
      strategyType = aiPlan.strategyType;
      tokenIn = forcedIn || aiPlan.tokenIn;
      tokenOut = forcedOut || aiPlan.tokenOut;
      if (!TOKENS[tokenIn] || !TOKENS[tokenOut] || tokenIn === tokenOut) {
        throw new HttpError(400, `Unsupported or identical token pair ${tokenIn}/${tokenOut}`);
      }
      useUniswapV4Hop = strategyType !== 'aqua_position' && aiPlan.useUniswapV4Hop;
      rationale = aiPlan.rationale;
      summary = aiPlan.summary;
      riskNotes = aiPlan.riskNotes;
    } else {
      const rules = this.interpretGoal(goalPrompt, opts);
      ({ strategyType, tokenIn, tokenOut, useUniswapV4Hop, rationale } = rules);
      summary = `${strategyType === 'aqua_position' ? 'Deposit' : 'Swap'} $${amountUSD.toLocaleString('en-US')} of ${tokenIn}${
        strategyType === 'aqua_position' ? ' into a 1inch Aqua position' : ` into ${tokenOut}`
      }${useUniswapV4Hop ? ' through the agent-gated Uniswap v4 hook' : ''}.`;
      if (requiresBiometrics) riskNotes.push(`At or above the $${thresholdUSD.toLocaleString('en-US')} threshold, so the owner must approve with World ID.`);
    }
    rationale = [...rationale, ...checks];

    const inAddr = TOKENS[tokenIn].address;
    const outAddr = TOKENS[tokenOut].address;
    const { instructions, encodedCallData } =
      strategyType === 'aqua_position'
        ? this.swapVMService.buildAquaPositionInstructions(inAddr, outAddr, amountUSD)
        : this.swapVMService.buildSwapVMInstructions(inAddr, outAddr, amountUSD, {
            useUniswapV4Hop,
            splitRoute: strategyType === 'split_swap',
          });

    const quote = await this.quote(tokenIn, tokenOut, amountUSD);

    const proposal: TradeStrategyProposal = {
      strategyId: `strat_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      strategyType,
      planner: aiPlan ? 'claude' : 'rules',
      plannerModel: aiPlan ? claudePlanner.model : undefined,
      summary,
      rationale,
      riskNotes,
      agentSubname,
      targetProtocol: '1inch_SwapVM',
      usesUniswapV4Hop: useUniswapV4Hop,
      tokenInSymbol: tokenIn,
      tokenOutSymbol: tokenOut,
      amountIn: amountUSD.toString(),
      estimatedOutput: quote.output,
      quoteSource: quote.source,
      estimatedValueUSD: amountUSD,
      requiresBiometric2FA: requiresBiometrics,
      biometricThresholdUSD: thresholdUSD,
      authorization,
      dailyLimit,
      instructions,
      createdAt: new Date().toISOString(),
    };

    return { proposal, encodedCallData, targetContract };
  }
}

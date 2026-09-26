export interface AgentSubnameConfig {
  subnameNode: string;
  subnameLabel: string;
  subnameFull: string;
  agentAddress: string;
  ownerAddress: string;
  biometricThresholdUSD: number;
  dailySpendingLimitUSD: number;
  currentDailySpentUSD: number;
  isActive: boolean;
}

export interface SwapInstructionDTO {
  opcode: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minAmountOut: string;
  extraData?: string;
}

export type StrategyType = 'swap' | 'split_swap' | 'aqua_position';

export interface TradeStrategyProposal {
  strategyId: string;
  strategyType: StrategyType;
  /** Who chose the plan: Claude, or the deterministic fallback rules */
  planner: 'claude' | 'rules';
  plannerModel?: string;
  /** One plain-English sentence describing the plan */
  summary: string;
  rationale: string[];
  riskNotes: string[];
  /** Registered ENS name, or null when the agent has no identity yet */
  agentSubname: string | null;
  targetProtocol: '1inch_SwapVM' | 'Uniswap_v4';
  usesUniswapV4Hop: boolean;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  amountIn: string;
  estimatedOutput: string;
  quoteSource: '1inch_api' | 'static_estimate';
  estimatedValueUSD: number;
  requiresBiometric2FA: boolean;
  biometricThresholdUSD: number;
  /** Onchain isAgentAuthorized result; null when the agent or RPC could not be checked */
  authorization: { isAllowed: boolean; requiresBiometrics: boolean } | null;
  /**
   * The contract checks the daily limit only when the trade executes, so a trade over the
   * limit would be queued and then revert. Surfaced here so the UI can stop it up front.
   */
  dailyLimit: { limitUSD: number; spentTodayUSD: number; remainingUSD: number | null; exceeds: boolean } | null;
  instructions: SwapInstructionDTO[];
  createdAt: string;
}

export interface BiometricVerificationPayload {
  requestId: string;
  merkle_root?: string;
  nullifier_hash: string;
  proof?: string;
  verification_level?: string;
  verificationSource: 'World_IDKit_Cloud' | 'Onchain_ZK_Proof';
}

export type ExecutionMode = 'onchain' | 'simulated';

export interface ExecutionStatusResponse {
  requestId: string;
  status: 'PENDING_BIOMETRICS' | 'BIOMETRICS_VERIFIED' | 'EXECUTED' | 'CANCELLED';
  /** onchain = real AegisExecutionManager request; simulated = nothing was sent to the chain */
  mode: ExecutionMode;
  simulationReason?: string;
  agentAddress: string;
  agentSubname: string;
  valueUSD: number;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  strategyType: StrategyType;
  targetContract: string;
  txHash?: string;
  verificationTxHash?: string;
  cancelTxHash?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

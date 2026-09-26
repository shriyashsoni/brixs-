import { ethers } from 'ethers';
import { config } from '../config';
import { wallet, signerAddress, sendTx, chainError } from '../chain';
import { ManagerABI } from '../abis';
import { AIAgentService, StrategyOptions } from './aiAgent.service';
import { indexer } from './indexer.service';
import { HttpError, usdToWei } from '../validate';

/**
 * Server-side execution for automated bots whose agent key is the backend wallet.
 * Everything here is a real transaction on AegisExecutionManager; there is no simulation.
 * People using the console sign with their own wallet instead (see frontend/chain.js).
 */
export class ExecutionService {
  private manager = new ethers.Contract(config.contracts.AegisExecutionManager, ManagerABI, wallet);
  private aiAgentService = new AIAgentService();

  async processAgentRequest(agentAddress: string, goalPrompt: string, valueUSD: number, opts: StrategyOptions = {}) {
    if (agentAddress.toLowerCase() !== signerAddress.toLowerCase()) {
      throw new HttpError(
        400,
        `The contract checks msg.sender, so the backend can only act as its own agent (${signerAddress}). Sign from the agent's wallet in the console instead.`
      );
    }

    const { proposal, encodedCallData, targetContract } = await this.aiAgentService.evaluateAndProposeStrategy(
      agentAddress,
      goalPrompt,
      valueUSD,
      opts
    );
    if (!proposal.authorization) throw new HttpError(403, `Agent ${agentAddress} has no ENS identity. Register it first.`);
    if (!proposal.authorization.isAllowed) throw new HttpError(403, 'Agent is inactive or the SwapVM adapter is not whitelisted for it.');

    let receipt: ethers.TransactionReceipt;
    try {
      receipt = await sendTx((o) => this.manager.requestExecution(targetContract, encodedCallData, usdToWei(valueUSD), o));
    } catch (err) {
      throw new HttpError(502, `requestExecution failed: ${chainError(err)}`);
    }

    const event = receipt.logs
      .map((log) => {
        try {
          return this.manager.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === 'ExecutionRequested');
    if (!event) throw new HttpError(502, `Transaction ${receipt.hash} did not emit ExecutionRequested`);

    await indexer.refresh().catch(() => undefined);
    return {
      requestId: String(event.args.requestId),
      requiresBiometrics: Boolean(event.args.requiresBiometrics),
      txHash: receipt.hash,
      proposal,
    };
  }

  async executeVerified(requestId: string) {
    try {
      const receipt = await sendTx((o) => this.manager.executeVerifiedTransaction(requestId, o));
      await indexer.refresh().catch(() => undefined);
      return { requestId, txHash: receipt.hash };
    } catch (err) {
      throw new HttpError(502, `executeVerifiedTransaction failed: ${chainError(err)}`);
    }
  }

  async cancel(requestId: string) {
    try {
      const receipt = await sendTx((o) => this.manager.cancelExecution(requestId, o));
      await indexer.refresh().catch(() => undefined);
      return { requestId, txHash: receipt.hash };
    } catch (err) {
      throw new HttpError(502, `cancelExecution failed: ${chainError(err)}`);
    }
  }
}

export const executionService = new ExecutionService();

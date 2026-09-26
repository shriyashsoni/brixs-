import { ethers } from 'ethers';
import { SwapInstructionDTO } from '../types';
import { usdToWei } from '../validate';

export const OP = {
  EXCHANGE_SWAP: 0x01,
  SPLIT_ROUTE: 0x02,
  VERIFY_MIN_OUTPUT: 0x03,
  UNISWAP_V4_HOP: 0x04,
  AQUA_DEPOSIT: 0x05,
  AQUA_WITHDRAW: 0x06,
} as const;

export class SwapVMService {
  /**
   * Constructs 1inch SwapVM opcodes for a swap, optionally split across sources and/or
   * hopping through the agent-gated Uniswap v4 hook, ending with a slippage check.
   */
  buildSwapVMInstructions(
    tokenIn: string,
    tokenOut: string,
    amountUSD: number,
    { useUniswapV4Hop = false, splitRoute = false } = {}
  ): { instructions: SwapInstructionDTO[]; encodedCallData: string } {
    const amountIn = usdToWei(amountUSD);
    // Mirrors the adapter: direct swap keeps 99.5%, split route 99.8%, v4 hop 99.6%
    const firstOut = splitRoute ? (amountIn * 998n) / 1000n : (amountIn * 995n) / 1000n;

    const instructions: SwapInstructionDTO[] = [
      {
        opcode: splitRoute ? OP.SPLIT_ROUTE : OP.EXCHANGE_SWAP,
        tokenIn,
        tokenOut,
        amountIn: amountIn.toString(),
        minAmountOut: firstOut.toString(),
        extraData: '0x',
      },
    ];

    if (useUniswapV4Hop) {
      instructions.push({
        opcode: OP.UNISWAP_V4_HOP,
        tokenIn,
        tokenOut,
        amountIn: firstOut.toString(),
        minAmountOut: ((firstOut * 996n) / 1000n).toString(),
        extraData: '0x',
      });
    }

    instructions.push({
      opcode: OP.VERIFY_MIN_OUTPUT, // Slippage safety check: 0.5% under the first leg
      tokenIn,
      tokenOut,
      amountIn: '0',
      minAmountOut: ((firstOut * 995n) / 1000n).toString(),
      extraData: '0x',
    });

    return this._encodeInstructions(instructions);
  }

  /**
   * Constructs 1inch Aqua self-custodial position instructions (0x05 Deposit, 0x06 Withdraw/rebalance)
   */
  buildAquaPositionInstructions(
    tokenIn: string,
    tokenOut: string,
    amountUSD: number
  ): { instructions: SwapInstructionDTO[]; encodedCallData: string } {
    const amountIn = usdToWei(amountUSD);

    const instructions: SwapInstructionDTO[] = [
      {
        opcode: OP.AQUA_DEPOSIT,
        tokenIn,
        tokenOut,
        amountIn: amountIn.toString(),
        minAmountOut: amountIn.toString(),
        extraData: '0x',
      },
      {
        opcode: OP.AQUA_WITHDRAW,
        tokenIn,
        tokenOut,
        amountIn: amountIn.toString(),
        minAmountOut: ((amountIn * 1020n) / 1000n).toString(), // 2% yield harvest
        extraData: '0x',
      },
    ];

    return this._encodeInstructions(instructions);
  }

  private _encodeInstructions(instructions: SwapInstructionDTO[]): { instructions: SwapInstructionDTO[]; encodedCallData: string } {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const encodedInstructions = abiCoder.encode(
      ['tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]'],
      [
        instructions.map((i) => ({
          opcode: i.opcode,
          tokenIn: i.tokenIn,
          tokenOut: i.tokenOut,
          amountIn: BigInt(i.amountIn),
          minAmountOut: BigInt(i.minAmountOut),
          extraData: i.extraData || '0x',
        })),
      ]
    );

    const swapInterface = new ethers.Interface([
      'function executeSwapVMRoute(bytes calldata encodedInstructions) external returns (uint256)',
    ]);
    const encodedCallData = swapInterface.encodeFunctionData('executeSwapVMRoute', [encodedInstructions]);

    return { instructions, encodedCallData };
  }
}

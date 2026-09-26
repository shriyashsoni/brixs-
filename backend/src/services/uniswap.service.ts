import { ethers } from 'ethers';
import { config } from '../config';
import { wallet, sendTx } from '../chain';

const HookABI = [
  'function setPoolGated(bytes32 poolId, bool isGated) external',
  'function gatedPools(bytes32 poolId) external view returns (bool)',
  'function owner() external view returns (address)',
];

export class UniswapService {
  private hookContract = new ethers.Contract(config.contracts.AegisUniswapV4Hook, HookABI, wallet);

  /** Accepts a bytes32 pool ID, or any label (e.g. "USDC/WETH-0.3%") which is hashed into one */
  static toPoolId(poolId: string): string {
    return ethers.isHexString(poolId, 32) ? poolId : ethers.keccak256(ethers.toUtf8Bytes(poolId));
  }

  async isPoolGated(poolId: string): Promise<boolean> {
    return this.hookContract.gatedPools(UniswapService.toPoolId(poolId));
  }

  async getHookOwner(): Promise<string> {
    return this.hookContract.owner();
  }

  async setPoolGated(poolId: string, isGated: boolean): Promise<string> {
    const receipt = await sendTx((o) => this.hookContract.setPoolGated(UniswapService.toPoolId(poolId), isGated, o));
    return receipt.hash;
  }
}

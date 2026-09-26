import { ethers } from 'ethers';
import { config } from '../config';
import { wallet, sendTx } from '../chain';
import { AgentSubnameConfig } from '../types';
import { usdToWei } from '../validate';

const RegistryABI = [
  'function registerSubname(string calldata subnameLabel, address agentAddress, uint256 biometricThresholdUSD, uint256 dailySpendingLimit) external returns (bytes32 subnameNode)',
  'function setTargetContractWhitelist(bytes32 subnameNode, address targetContract, bool isWhitelisted) external',
  'function updateBiometricThreshold(bytes32 subnameNode, uint256 newThresholdUSD) external',
  'function revokeSubname(bytes32 subnameNode) external',
  'function getAgentPermissions(bytes32 subnameNode) external view returns (tuple(bytes32 subnameNode, string subname, address agentAddress, address ownerAddress, uint256 biometricThresholdUSD, bool isActive, uint256 dailySpendingLimit, uint256 currentDailySpent, uint256 lastSpentTimestamp))',
  'function isAgentAuthorized(address agentAddress, address targetContract, uint256 transactionValueUSD) external view returns (bool isAllowed, bool requiresBiometrics, bytes32 subnameNode)',
  'function agentToNode(address agentAddress) external view returns (bytes32)',
  'function whitelistedTargets(bytes32 subnameNode, address targetContract) external view returns (bool)',
  'function setTextRecord(bytes32 subnameNode, string calldata key, string calldata value) external',
  'function getTextRecord(bytes32 subnameNode, string calldata key) external view returns (string memory)',
  'event SubnameRegistered(bytes32 indexed subnameNode, string subname, address indexed agent, address indexed owner)',
];

const DAY = 24 * 60 * 60;

export class ENSService {
  private registryContract = new ethers.Contract(config.contracts.AegisSubnameRegistry, RegistryABI, wallet);

  /**
   * Registers a new agent subname (e.g., agent1.shriyash.eth) with Enhanced Access Control (EAC)
   */
  async registerAgentSubname(
    label: string,
    agentAddress: string,
    biometricThresholdUSD: number = config.biometricDefaultThresholdUSD,
    dailySpendingLimitUSD: number = 50000
  ): Promise<{ subnameFull: string; subnameNode: string; txHash: string; whitelistTxHashes: string[] }> {
    const receipt = await sendTx((o) => this.registryContract.registerSubname(label, agentAddress, usdToWei(biometricThresholdUSD), usdToWei(dailySpendingLimitUSD), o)
    );

    // Read the node from the event rather than agentToNode, which a later registration could overwrite
    const event = receipt.logs
      .map((log) => {
        try {
          return this.registryContract.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === 'SubnameRegistered');
    const subnameNode: string = event ? event.args.subnameNode : await this.registryContract.agentToNode(agentAddress);

    // Automatically whitelist default DeFi targets (SwapVM Adapter & Uniswap Hook)
    const whitelistTxHashes = [
      await this.setTargetContractWhitelist(subnameNode, config.contracts.AegisSwapVMAdapter, true),
      await this.setTargetContractWhitelist(subnameNode, config.contracts.AegisUniswapV4Hook, true),
    ];

    return {
      subnameFull: `${label}.${config.rootEnsName}`,
      subnameNode,
      txHash: receipt.hash,
      whitelistTxHashes,
    };
  }

  async setTargetContractWhitelist(subnameNode: string, targetContract: string, isWhitelisted: boolean): Promise<string> {
    const receipt = await sendTx((o) => this.registryContract.setTargetContractWhitelist(subnameNode, targetContract, isWhitelisted, o));
    return receipt.hash;
  }

  async isTargetWhitelisted(subnameNode: string, targetContract: string): Promise<boolean> {
    return this.registryContract.whitelistedTargets(subnameNode, targetContract);
  }

  async updateBiometricThreshold(subnameNode: string, thresholdUSD: number): Promise<string> {
    const receipt = await sendTx((o) => this.registryContract.updateBiometricThreshold(subnameNode, usdToWei(thresholdUSD), o));
    return receipt.hash;
  }

  async revokeSubname(subnameNode: string): Promise<string> {
    const receipt = await sendTx((o) => this.registryContract.revokeSubname(subnameNode, o));
    return receipt.hash;
  }

  async getPermissionsByNode(node: string): Promise<AgentSubnameConfig | null> {
    const perm = await this.registryContract.getAgentPermissions(node);
    if (perm.agentAddress === ethers.ZeroAddress) return null;

    // The contract only resets the daily counter on the next spend, so mirror that reset for display
    const windowExpired = Date.now() / 1000 >= Number(perm.lastSpentTimestamp) + DAY;

    return {
      subnameNode: node,
      subnameLabel: perm.subname,
      subnameFull: `${perm.subname}.${config.rootEnsName}`,
      agentAddress: perm.agentAddress,
      ownerAddress: perm.ownerAddress,
      biometricThresholdUSD: parseFloat(ethers.formatEther(perm.biometricThresholdUSD)),
      dailySpendingLimitUSD: parseFloat(ethers.formatEther(perm.dailySpendingLimit)),
      currentDailySpentUSD: windowExpired ? 0 : parseFloat(ethers.formatEther(perm.currentDailySpent)),
      isActive: perm.isActive,
    };
  }

  /**
   * Returns null only when the address has no subname. RPC failures throw so callers
   * don't mistake an outage for "not registered".
   */
  async getAgentPermissionsByAddress(agentAddress: string): Promise<AgentSubnameConfig | null> {
    const node: string = await this.registryContract.agentToNode(agentAddress);
    if (!node || node === ethers.ZeroHash) return null;
    return this.getPermissionsByNode(node);
  }

  async verifyAgentAuthorization(agentAddress: string, targetContract: string, valueUSD: number) {
    const res = await this.registryContract.isAgentAuthorized(agentAddress, targetContract, usdToWei(valueUSD));
    return {
      isAllowed: res.isAllowed as boolean,
      requiresBiometrics: res.requiresBiometrics as boolean,
      subnameNode: res.subnameNode as string,
    };
  }

  async setTextRecord(subnameNode: string, key: string, value: string): Promise<string> {
    const receipt = await sendTx((o) => this.registryContract.setTextRecord(subnameNode, key, value, o));
    return receipt.hash;
  }

  async getTextRecord(subnameNode: string, key: string): Promise<string> {
    return await this.registryContract.getTextRecord(subnameNode, key);
  }
}

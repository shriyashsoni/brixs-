/**
 * Human-readable ABIs for the deployed AegisNet contracts.
 * Served to the browser at /api/abis so the console and backend never drift.
 */
export const RegistryABI = [
  'function registerSubname(string subnameLabel, address agentAddress, uint256 biometricThresholdUSD, uint256 dailySpendingLimit) returns (bytes32 subnameNode)',
  'function setTargetContractWhitelist(bytes32 subnameNode, address targetContract, bool isWhitelisted)',
  'function updateBiometricThreshold(bytes32 subnameNode, uint256 newThresholdUSD)',
  'function revokeSubname(bytes32 subnameNode)',
  'function setTextRecord(bytes32 subnameNode, string key, string value)',
  'function getTextRecord(bytes32 subnameNode, string key) view returns (string)',
  'function getAgentPermissions(bytes32 subnameNode) view returns (tuple(bytes32 subnameNode, string subname, address agentAddress, address ownerAddress, uint256 biometricThresholdUSD, bool isActive, uint256 dailySpendingLimit, uint256 currentDailySpent, uint256 lastSpentTimestamp))',
  'function isAgentAuthorized(address agentAddress, address targetContract, uint256 transactionValueUSD) view returns (bool isAllowed, bool requiresBiometrics, bytes32 subnameNode)',
  'function agentToNode(address agentAddress) view returns (bytes32)',
  'function whitelistedTargets(bytes32 subnameNode, address targetContract) view returns (bool)',
  'function rootNode() view returns (bytes32)',
  'event SubnameRegistered(bytes32 indexed subnameNode, string subname, address indexed agent, address indexed owner)',
  'event TargetContractWhitelisted(bytes32 indexed subnameNode, address indexed targetContract, bool isWhitelisted)',
  'event BiometricThresholdUpdated(bytes32 indexed subnameNode, uint256 newThresholdUSD)',
  'event SubnameRevoked(bytes32 indexed subnameNode)',
  'event TextRecordChanged(bytes32 indexed subnameNode, string key, string value)',
];

export const ManagerABI = [
  'function requestExecution(address targetContract, bytes callData, uint256 valueUSD) returns (bytes32 requestId, bool requiresBiometrics)',
  'function verifyBiometricsWithRelayer(bytes32 requestId, uint256 nullifierHash, bytes signature)',
  'function executeVerifiedTransaction(bytes32 requestId) returns (bool success, bytes returnData)',
  'function cancelExecution(bytes32 requestId)',
  'function executionRequests(bytes32) view returns (bytes32 requestId, address agentAddress, address targetContract, bytes callData, uint256 valueUSD, uint256 createdAt, bool isVerified, bool isExecuted, bool isCancelled)',
  'function usedNullifiers(uint256) view returns (bool)',
  'function relayerSigner() view returns (address)',
  'function owner() view returns (address)',
  'event ExecutionRequested(bytes32 indexed requestId, address indexed agent, address indexed targetContract, uint256 valueUSD, bool requiresBiometrics)',
  'event ExecutionBiometricsVerified(bytes32 indexed requestId, uint256 nullifierHash)',
  'event ExecutionExecuted(bytes32 indexed requestId, address indexed targetContract, bool success, bytes returnData)',
  'event ExecutionCancelled(bytes32 indexed requestId)',
];

export const HookABI = [
  'function setPoolGated(bytes32 poolId, bool isGated)',
  'function gatedPools(bytes32 poolId) view returns (bool)',
  'function owner() view returns (address)',
  'event PoolGatedStatusUpdated(bytes32 indexed poolId, bool isGated)',
];

export const AdapterABI = [
  'function executeSwapVMRoute(bytes encodedInstructions) returns (uint256 finalOutputAmount)',
  'event SwapVMExecuted(address indexed srcToken, address indexed dstToken, uint256 inputAmount, uint256 outputAmount)',
];

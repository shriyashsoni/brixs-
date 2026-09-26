// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAegisSubnameRegistry
 * @notice Interface for AegisNet ENSv2 Subname & Enhanced Access Control (EAC) Registry
 */
interface IAegisSubnameRegistry {
    struct AgentPermissions {
        bytes32 subnameNode;      // ENSv2 node hash (e.g., namehash("agent1.shriyash.eth"))
        string subname;           // Human readable subname (e.g., "agent1.shriyash.eth")
        address agentAddress;     // Onchain agent wallet address
        address ownerAddress;     // Human owner address (e.g., owner of shriyash.eth)
        uint256 biometricThresholdUSD; // Transaction value threshold triggering World ID 2FA (e.g. $1000 in 18 decimals)
        bool isActive;            // Active delegation status
        uint256 dailySpendingLimit; // Max daily execution limit
        uint256 currentDailySpent;  // Spent today
        uint256 lastSpentTimestamp; // Timestamp of last spend update
    }

    event SubnameRegistered(bytes32 indexed subnameNode, string subname, address indexed agent, address indexed owner);
    event TargetContractWhitelisted(bytes32 indexed subnameNode, address indexed targetContract, bool isWhitelisted);
    event BiometricThresholdUpdated(bytes32 indexed subnameNode, uint256 newThresholdUSD);
    event SubnameRevoked(bytes32 indexed subnameNode);
    event TextRecordChanged(bytes32 indexed subnameNode, string key, string value);

    function registerSubname(
        string calldata subnameLabel,
        address agentAddress,
        uint256 biometricThresholdUSD,
        uint256 dailySpendingLimit
    ) external returns (bytes32 subnameNode);

    function setTargetContractWhitelist(bytes32 subnameNode, address targetContract, bool isWhitelisted) external;
    function updateBiometricThreshold(bytes32 subnameNode, uint256 newThresholdUSD) external;
    function revokeSubname(bytes32 subnameNode) external;

    function getAgentPermissions(bytes32 subnameNode) external view returns (AgentPermissions memory);

    function isAgentAuthorized(
        address agentAddress,
        address targetContract,
        uint256 transactionValueUSD
    ) external view returns (bool isAllowed, bool requiresBiometrics, bytes32 subnameNode);

    function recordSpend(bytes32 subnameNode, uint256 amountUSD) external;

    function setTextRecord(bytes32 subnameNode, string calldata key, string calldata value) external;
    function getTextRecord(bytes32 subnameNode, string calldata key) external view returns (string memory);
}


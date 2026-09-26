// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IAegisSubnameRegistry.sol";

/**
 * @title AegisSubnameRegistry
 * @notice AegisNet Hierarchical ENSv2 Subname Registry & EAC (Enhanced Access Control)
 * @dev Manages agent subname permissions, biometric verification triggers, and target router whitelists.
 */
contract AegisSubnameRegistry is IAegisSubnameRegistry {
    bytes32 public immutable rootNode; // Node hash of root ENS name (e.g. shriyash.eth)
    address public owner;

    // Subname Node => Agent Permissions
    mapping(bytes32 => AgentPermissions) public agentRegistry;
    // Agent Address => Subname Node
    mapping(address => bytes32) public agentToNode;
    // Subname Node => Target Contract => Whitelisted Status
    mapping(bytes32 => mapping(address => bool)) public whitelistedTargets;
    // ENSIP-26 Subname Node => Key => Text Value (e.g. agent.capabilities, agent.biometric_threshold)
    mapping(bytes32 => mapping(string => string)) public textRecords;

    modifier onlyOwner() {
        require(msg.sender == owner, "AegisRegistry: caller is not owner");
        _;
    }

    modifier onlyAgentOwner(bytes32 subnameNode) {
        require(agentRegistry[subnameNode].ownerAddress == msg.sender || msg.sender == owner, "AegisRegistry: not authorized owner");
        _;
    }

    constructor(string memory rootName) {
        owner = msg.sender;
        rootNode = keccak256(abi.encodePacked(bytes32(0), keccak256(bytes(rootName))));
    }

    function getAgentPermissions(bytes32 subnameNode) external view override returns (AgentPermissions memory) {
        return agentRegistry[subnameNode];
    }

    /**
     * @notice Set ENSIP-26 Agent Text Records (e.g., agent.capabilities, agent.biometric_threshold)
     */
    function setTextRecord(
        bytes32 subnameNode,
        string calldata key,
        string calldata value
    ) external override onlyAgentOwner(subnameNode) {
        require(agentRegistry[subnameNode].isActive, "AegisRegistry: subname inactive");
        textRecords[subnameNode][key] = value;
        emit TextRecordChanged(subnameNode, key, value);
    }

    /**
     * @notice Resolve ENSIP-26 Agent Text Records
     */
    function getTextRecord(
        bytes32 subnameNode,
        string calldata key
    ) external view override returns (string memory) {
        return textRecords[subnameNode][key];
    }

    /**
     * @notice Register a new agent subname under the root ENS namespace
     * @param subnameLabel Label for the subname (e.g., "agent1" for "agent1.shriyash.eth")
     * @param agentAddress Address of the AI agent runner
     * @param biometricThresholdUSD USD value (in 18 decimals) exceeding which World ID 2FA is required ($1,000 default = 1000e18)
     * @param dailySpendingLimit Max aggregated transaction limit per 24 hours
     */
    function registerSubname(
        string calldata subnameLabel,
        address agentAddress,
        uint256 biometricThresholdUSD,
        uint256 dailySpendingLimit
    ) external override returns (bytes32 subnameNode) {
        bytes32 labelHash = keccak256(bytes(subnameLabel));
        subnameNode = keccak256(abi.encodePacked(rootNode, labelHash));

        require(agentAddress != address(0), "AegisRegistry: invalid agent address");
        require(!agentRegistry[subnameNode].isActive, "AegisRegistry: subname already registered");

        agentRegistry[subnameNode] = AgentPermissions({
            subnameNode: subnameNode,
            subname: subnameLabel,
            agentAddress: agentAddress,
            ownerAddress: msg.sender,
            biometricThresholdUSD: biometricThresholdUSD,
            isActive: true,
            dailySpendingLimit: dailySpendingLimit,
            currentDailySpent: 0,
            lastSpentTimestamp: block.timestamp
        });

        agentToNode[agentAddress] = subnameNode;

        emit SubnameRegistered(subnameNode, subnameLabel, agentAddress, msg.sender);
    }

    /**
     * @notice Whitelist an allowed target contract (e.g., 1inch SwapVM Router, Uniswap v4 Hook)
     */
    function setTargetContractWhitelist(
        bytes32 subnameNode,
        address targetContract,
        bool isWhitelisted
    ) external override onlyAgentOwner(subnameNode) {
        require(agentRegistry[subnameNode].isActive, "AegisRegistry: subname inactive");
        whitelistedTargets[subnameNode][targetContract] = isWhitelisted;

        emit TargetContractWhitelisted(subnameNode, targetContract, isWhitelisted);
    }

    /**
     * @notice Update the World ID biometric interception threshold USD amount
     */
    function updateBiometricThreshold(
        bytes32 subnameNode,
        uint256 newThresholdUSD
    ) external override onlyAgentOwner(subnameNode) {
        require(agentRegistry[subnameNode].isActive, "AegisRegistry: subname inactive");
        agentRegistry[subnameNode].biometricThresholdUSD = newThresholdUSD;

        emit BiometricThresholdUpdated(subnameNode, newThresholdUSD);
    }

    /**
     * @notice Revoke agent authority & disable subname execution
     */
    function revokeSubname(bytes32 subnameNode) external override onlyAgentOwner(subnameNode) {
        require(agentRegistry[subnameNode].isActive, "AegisRegistry: subname inactive");
        agentRegistry[subnameNode].isActive = false;
        delete agentToNode[agentRegistry[subnameNode].agentAddress];

        emit SubnameRevoked(subnameNode);
    }

    /**
     * @notice Record spend amount for daily limit calculations
     */
    function recordSpend(bytes32 subnameNode, uint256 amountUSD) external override {
        AgentPermissions storage perm = agentRegistry[subnameNode];
        require(perm.isActive, "AegisRegistry: subname inactive");

        // Reset daily spend if 24 hours elapsed
        if (block.timestamp >= perm.lastSpentTimestamp + 1 days) {
            perm.currentDailySpent = amountUSD;
            perm.lastSpentTimestamp = block.timestamp;
        } else {
            perm.currentDailySpent += amountUSD;
        }

        require(
            perm.dailySpendingLimit == 0 || perm.currentDailySpent <= perm.dailySpendingLimit,
            "AegisRegistry: daily spending limit exceeded"
        );
    }

    /**
     * @notice Authorizes whether an agent can interact with a target contract and if biometric proof is required
     */
    function isAgentAuthorized(
        address agentAddress,
        address targetContract,
        uint256 transactionValueUSD
    ) external view override returns (bool isAllowed, bool requiresBiometrics, bytes32 subnameNode) {
        subnameNode = agentToNode[agentAddress];
        if (subnameNode == bytes32(0)) {
            return (false, false, bytes32(0));
        }

        AgentPermissions storage perm = agentRegistry[subnameNode];
        if (!perm.isActive) {
            return (false, false, subnameNode);
        }

        // EAC Check: Target contract must be explicitly whitelisted
        if (!whitelistedTargets[subnameNode][targetContract]) {
            return (false, false, subnameNode);
        }

        // Biometric check: if transactionValueUSD >= biometricThresholdUSD, requires biometrics
        requiresBiometrics = (perm.biometricThresholdUSD > 0 && transactionValueUSD >= perm.biometricThresholdUSD);

        return (true, requiresBiometrics, subnameNode);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IAegisSubnameRegistry.sol";
import "./interfaces/IWorldID.sol";

/**
 * @title AegisExecutionManager
 * @notice Central Orchestrator & World ID Biometric Interception Gatekeeper
 */
contract AegisExecutionManager {
    IAegisSubnameRegistry public immutable registry;
    IWorldID public immutable worldID;

    address public owner;
    address public relayerSigner; // Authorized relayer for off-chain verified World ID ZK sessions

    // World ID parameters
    uint256 public immutable worldIdGroupId;
    uint256 public immutable externalNullifier;

    // Track used nullifiers to prevent replay attacks
    mapping(uint256 => bool) public usedNullifiers;

    // Pending Execution Request for Biometric Interception
    struct ExecutionRequest {
        bytes32 requestId;
        address agentAddress;
        address targetContract;
        bytes callData;
        uint256 valueUSD;
        uint256 createdAt;
        bool isVerified;
        bool isExecuted;
        bool isCancelled;
    }

    mapping(bytes32 => ExecutionRequest) public executionRequests;

    event ExecutionRequested(
        bytes32 indexed requestId,
        address indexed agent,
        address indexed targetContract,
        uint256 valueUSD,
        bool requiresBiometrics
    );
    event ExecutionBiometricsVerified(bytes32 indexed requestId, uint256 nullifierHash);
    event ExecutionExecuted(bytes32 indexed requestId, address indexed targetContract, bool success, bytes returnData);
    event ExecutionCancelled(bytes32 indexed requestId);

    modifier onlyOwner() {
        require(msg.sender == owner, "AegisManager: caller is not owner");
        _;
    }

    constructor(
        address _registry,
        address _worldID,
        uint256 _groupId,
        uint256 _externalNullifier,
        address _relayerSigner
    ) {
        owner = msg.sender;
        registry = IAegisSubnameRegistry(_registry);
        worldID = IWorldID(_worldID);
        worldIdGroupId = _groupId;
        externalNullifier = _externalNullifier;
        relayerSigner = _relayerSigner;
    }

    function setRelayerSigner(address _signer) external onlyOwner {
        relayerSigner = _signer;
    }

    /**
     * @notice Submit a proposed transaction execution from an autonomous AI agent
     * @param targetContract Whitelisted target contract address
     * @param callData Encoded call payload for swap/liquidity positioning
     * @param valueUSD Estimated transaction dollar value in 18 decimals
     */
    function requestExecution(
        address targetContract,
        bytes calldata callData,
        uint256 valueUSD
    ) external returns (bytes32 requestId, bool requiresBiometrics) {
        (bool isAllowed, bool biometricReq, bytes32 subnameNode) = registry.isAgentAuthorized(
            msg.sender,
            targetContract,
            valueUSD
        );

        require(isAllowed, "AegisManager: Agent or target not authorized by ENS EAC");

        requestId = keccak256(
            abi.encodePacked(
                msg.sender,
                targetContract,
                keccak256(callData),
                valueUSD,
                block.timestamp,
                block.chainid
            )
        );

        executionRequests[requestId] = ExecutionRequest({
            requestId: requestId,
            agentAddress: msg.sender,
            targetContract: targetContract,
            callData: callData,
            valueUSD: valueUSD,
            createdAt: block.timestamp,
            isVerified: !biometricReq, // Pre-verified if below biometric threshold
            isExecuted: false,
            isCancelled: false
        });

        emit ExecutionRequested(requestId, msg.sender, targetContract, valueUSD, biometricReq);

        // If below threshold ($1,000), execute immediately atomically
        if (!biometricReq) {
            _executeTransaction(requestId, subnameNode);
        }

        return (requestId, biometricReq);
    }

    /**
     * @notice Submit World ID Zero-Knowledge Proof to satisfy biometric 2FA for high-value executions (> $1,000)
     */
    function submitBiometricProof(
        bytes32 requestId,
        uint256 root,
        uint256 nullifierHash,
        uint256[8] calldata proof
    ) external {
        ExecutionRequest storage req = executionRequests[requestId];
        require(req.requestId != bytes32(0), "AegisManager: non-existent request");
        require(!req.isExecuted, "AegisManager: already executed");
        require(!req.isCancelled, "AegisManager: request cancelled");
        require(!req.isVerified, "AegisManager: already verified");
        require(!usedNullifiers[nullifierHash], "AegisManager: World ID nullifier already used");

        uint256 signalHash = uint256(keccak256(abi.encodePacked(requestId)));

        // Verify World ID ZK Proof onchain
        worldID.verifyProof(
            root,
            worldIdGroupId,
            signalHash,
            nullifierHash,
            externalNullifier,
            proof
        );

        usedNullifiers[nullifierHash] = true;
        req.isVerified = true;

        emit ExecutionBiometricsVerified(requestId, nullifierHash);
    }

    /**
     * @notice Submit World ID verification via trusted backend relayer signature (IDKit / World App Cloud verification)
     */
    function verifyBiometricsWithRelayer(
        bytes32 requestId,
        uint256 nullifierHash,
        bytes calldata signature
    ) external {
        ExecutionRequest storage req = executionRequests[requestId];
        require(req.requestId != bytes32(0), "AegisManager: non-existent request");
        require(!req.isExecuted, "AegisManager: already executed");
        require(!req.isCancelled, "AegisManager: request cancelled");
        require(!usedNullifiers[nullifierHash], "AegisManager: World ID nullifier used");

        bytes32 hash = keccak256(abi.encodePacked(requestId, nullifierHash, address(this), block.chainid));
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        
        address recovered = recoverSigner(ethSignedHash, signature);
        require(recovered == relayerSigner, "AegisManager: invalid relayer signature");

        usedNullifiers[nullifierHash] = true;
        req.isVerified = true;

        emit ExecutionBiometricsVerified(requestId, nullifierHash);
    }

    /**
     * @notice Execute an approved & verified transaction
     */
    function executeVerifiedTransaction(bytes32 requestId) external returns (bool success, bytes memory returnData) {
        ExecutionRequest storage req = executionRequests[requestId];
        require(req.isVerified, "AegisManager: pending biometric verification");
        require(!req.isExecuted, "AegisManager: request already executed");
        require(!req.isCancelled, "AegisManager: request cancelled");

        (, , bytes32 subnameNode) = registry.isAgentAuthorized(req.agentAddress, req.targetContract, req.valueUSD);
        return _executeTransaction(requestId, subnameNode);
    }

    /**
     * @notice Cancel pending execution (human owner fallback path)
     */
    function cancelExecution(bytes32 requestId) external {
        ExecutionRequest storage req = executionRequests[requestId];
        require(req.requestId != bytes32(0), "AegisManager: invalid request");
        require(!req.isExecuted, "AegisManager: request already executed");

        (, , bytes32 subnameNode) = registry.isAgentAuthorized(req.agentAddress, req.targetContract, req.valueUSD);
        IAegisSubnameRegistry.AgentPermissions memory perm = registry.getAgentPermissions(subnameNode);

        require(msg.sender == perm.ownerAddress || msg.sender == owner || msg.sender == perm.agentAddress, "AegisManager: unauthorized cancel");

        req.isCancelled = true;
        emit ExecutionCancelled(requestId);
    }

    function _executeTransaction(
        bytes32 requestId,
        bytes32 subnameNode
    ) internal returns (bool success, bytes memory returnData) {
        ExecutionRequest storage req = executionRequests[requestId];
        req.isExecuted = true;

        // Record spend in registry
        registry.recordSpend(subnameNode, req.valueUSD);

        // Forward call to whitelisted DeFi target contract
        (success, returnData) = req.targetContract.call(req.callData);
        require(success, "AegisManager: low level target call failed");

        emit ExecutionExecuted(requestId, req.targetContract, success, returnData);
    }

    function recoverSigner(bytes32 messageHash, bytes memory sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        return ecrecover(messageHash, v, r, s);
    }
}

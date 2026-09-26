// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IAegisSubnameRegistry.sol";

/**
 * @title AegisUniswapV4Hook
 * @notice Uniswap v4 Agent-Gated Liquidity Hook
 * @dev Enforces subname identity checking & World ID biometric verification on beforeSwap hooks.
 */
contract AegisUniswapV4Hook {
    IAegisSubnameRegistry public immutable registry;
    address public immutable executionManager;
    address public owner;

    // Track authorized pool IDs gated by AegisNet identity verification
    mapping(bytes32 => bool) public gatedPools;

    event PoolGatedStatusUpdated(bytes32 indexed poolId, bool isGated);
    event HookBeforeSwapPassed(address indexed sender, bytes32 indexed subnameNode, uint256 amountUSD);

    modifier onlyOwner() {
        require(msg.sender == owner, "UniswapHook: caller is not owner");
        _;
    }

    constructor(address _registry, address _executionManager) {
        owner = msg.sender;
        registry = IAegisSubnameRegistry(_registry);
        executionManager = _executionManager;
    }

    function setPoolGated(bytes32 poolId, bool isGated) external onlyOwner {
        gatedPools[poolId] = isGated;
        emit PoolGatedStatusUpdated(poolId, isGated);
    }

    /**
     * @notice Uniswap v4 beforeSwap hook callback interface
     * @param sender Address initiating the swap
     * @param poolId Identifier of the Uniswap v4 liquidity pool
     * @param amountUSD Estimated USD size of the trade
     */
    function beforeSwap(
        address sender,
        bytes32 poolId,
        uint256 amountUSD
    ) external returns (bytes4) {
        // If pool is not gated by AegisNet, allow immediately
        if (!gatedPools[poolId]) {
            return this.beforeSwap.selector;
        }

        // Caller must be AegisExecutionManager or an authorized agent
        require(
            sender == executionManager || tx.origin == executionManager,
            "UniswapHook: swap must be routed via AegisExecutionManager"
        );

        (bool isAllowed, bool requiresBiometrics, bytes32 subnameNode) = registry.isAgentAuthorized(
            tx.origin,
            address(this),
            amountUSD
        );

        require(isAllowed, "UniswapHook: origin agent not authorized by ENS EAC");
        require(!requiresBiometrics, "UniswapHook: biometric 2FA required via AegisExecutionManager");

        emit HookBeforeSwapPassed(sender, subnameNode, amountUSD);

        return this.beforeSwap.selector;
    }
}

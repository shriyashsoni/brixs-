// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IWorldID
 * @notice Interface for World ID ZK Proof Verifier
 */
interface IWorldID {
    function verifyProof(
        uint256 root,
        uint256 groupHash,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifierHash,
        uint256[8] calldata proof
    ) external view;
}

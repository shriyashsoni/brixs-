// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IWorldID.sol";

contract MockWorldID is IWorldID {
    bool public shouldPass = true;

    function setShouldPass(bool _pass) external {
        shouldPass = _pass;
    }

    function verifyProof(
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256[8] calldata
    ) external view override {
        require(shouldPass, "MockWorldID: invalid proof");
    }
}

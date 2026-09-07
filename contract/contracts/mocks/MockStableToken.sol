// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Mock BUSD-like stable token (18 decimals) used as the PancakeSwap settlement
///         target in tests and BSC Testnet demos, per PRD Section 5.1 ("token stabil,
///         mis. BUSD testnet").
contract MockStableToken is ERC20 {
    constructor(uint256 initialSupply) ERC20("Mock BUSD", "mBUSD") {
        _mint(msg.sender, initialSupply);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

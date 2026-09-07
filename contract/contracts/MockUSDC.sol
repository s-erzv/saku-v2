// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Mock USDC token for testing on BSC Testnet
 * @dev 6 decimals like real USDC, mintable for testing
 */
contract MockUSDC is ERC20 {
    /// @notice Maximum supply cap (10 million USDC for testing)
    uint256 public constant MAX_SUPPLY = 10_000_000 * 10**6;

    /**
     * @notice Constructor - mints initial supply to deployer
     * @param initialSupply Initial supply in USDC (6 decimals)
     */
    constructor(uint256 initialSupply) ERC20("USD Coin", "USDC") {
        require(initialSupply <= MAX_SUPPLY, "Initial supply exceeds max supply");
        _mint(msg.sender, initialSupply);
    }

    /**
     * @notice Mint new tokens (for testing purposes)
     * @param to Address to mint to
     * @param amount Amount to mint (6 decimals)
     */
    function mint(address to, uint256 amount) external {
        require(totalSupply() + amount <= MAX_SUPPLY, "Minting exceeds max supply");
        _mint(to, amount);
    }

    /**
     * @notice Get decimals (6 like real USDC)
     */
    function decimals() override public pure returns (uint8) {
        return 6;
    }
}

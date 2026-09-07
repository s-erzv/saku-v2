// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/MockUSDC.sol";
import "../contracts/mocks/MockStableToken.sol";
import "../contracts/SakuOfframpEscrow.sol";

/// @notice Deploys the full Saku v2 stack to BSC Testnet in dependency order:
///         MockStableToken -> MockUSDC -> SakuOfframpEscrow.
///         Mirrors the hardhat scripts (deployMockStableToken/deployMockUSDC/deployOfframpEscrow).
contract DeploySaku is Script {
    // Commonly published BSC Testnet infra addresses (override via env if moved).
    address constant DEFAULT_PANCAKE_ROUTER = 0xD99D1c33F9fC3444f8101754aBC46c52416550D1;
    address constant DEFAULT_CHAINLINK_BNBUSD = 0x2514895c72f50D8bd4B4F9b1110F0D6bD2c97526;

    function run() external {
        address pancakeRouter = _addrOr("PANCAKE_ROUTER_ADDRESS", DEFAULT_PANCAKE_ROUTER);
        address priceFeed = _addrOr("CHAINLINK_BNBUSD_FEED", DEFAULT_CHAINLINK_BNBUSD);
        address settler = _addrOr("SETTLER_ADDRESS", vm.addr(vm.envUint("PRIVATE_KEY")));

        vm.startBroadcast();

        // 1. MockStableToken (mBUSD, 18 decimals) — escrow settlement target.
        MockStableToken stable = new MockStableToken(1_000_000 * 10 ** 18);
        console2.log("MockStableToken (mBUSD):", address(stable));

        // 2. MockUSDC (6 decimals) — user-facing token.
        MockUSDC usdc = new MockUSDC(1_000_000 * 10 ** 6);
        console2.log("MockUSDC:", address(usdc));

        // 3. SakuOfframpEscrow — wires router + oracle + stable + settler.
        SakuOfframpEscrow escrow = new SakuOfframpEscrow(pancakeRouter, priceFeed, address(stable), settler);
        console2.log("SakuOfframpEscrow:", address(escrow));

        vm.stopBroadcast();

        console2.log("---- web/.env ----");
        console2.log("NEXT_PUBLIC_SAKU_ESCROW_ADDRESS=", address(escrow));
        console2.log("NEXT_PUBLIC_USDC_TOKEN_ADDRESS=", address(usdc));
        console2.log("STABLE_TOKEN_ADDRESS=", address(stable));
    }

    function _addrOr(string memory key, address defaultAddr) private view returns (address) {
        string memory v = vm.envOr(key, string(""));
        return bytes(v).length == 0 ? defaultAddr : vm.parseAddress(v);
    }
}

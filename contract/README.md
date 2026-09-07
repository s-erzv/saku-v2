# Saku v2 — Smart Contracts (BNB Smart Chain)

On-chain layer for **Saku v2**, an interoperable non-custodial wallet with Social Identity
Abstraction, built on **BNB Smart Chain (BSC Testnet)**. See `PRD_Saku_v2` for the full product
spec — this repo implements PRD Section 5 ("Backend Logic Flow").

> The v1-era wallet contracts (`SakuRegistry`, `USDCStaking`, `LockD`) have been removed — v2
> is scoped to the offramp escrow flow below. The web app's hooks/config that referenced them
> (`useRegistry`, `useStaking`, the old `NEXT_PUBLIC_SAKU_REGISTRY_ADDRESS` etc.) still need to
> be updated during the frontend integration pass.

## Contracts

| Contract | Purpose |
|---|---|
| `SakuOfframpEscrow.sol` | **Core PRD v2 deliverable.** Lock & Release escrow for cross-rail offramp transfers (Saku → GoPay/OVO/ShopeePay-style transfers). Locks a token, swaps it into a stable token via PancakeSwap once a backend settler confirms, refunds if the rate-lock expires. See [Escrow flow](#escrow-flow-lock--release) below. |
| `MockUSDC.sol` | 6-decimal mintable ERC20, used as the example token users lock in testnet demos. |
| `contracts/mocks/*` | `MockPancakeRouter`, `MockV3Aggregator`, `MockStableToken` — test doubles for PancakeSwap/Chainlink, used only in the Hardhat test suite. |

## Escrow flow (Lock & Release)

PRD Section 5.1/5.2: tokens are **locked and later actually swapped on-chain**, never burned and
re-minted — because these are assets with real market value, not an internal-only
representation.

1. User approves `SakuOfframpEscrow` and calls `lockForOfframp(amount, token, recipientPhoneHash, rateExpiry)`.
   - `recipientPhoneHash` is a `keccak256` hash — the plain-text phone number never touches this contract.
   - `rateExpiry` must be 30–120 seconds; the rate is only valid for that window.
   - Emits `OfframpRequested(user, amount, token, recipientHash, requestId, deadline)`.
2. An off-chain backend listener picks up `OfframpRequested` and, once the fiat leg is ready,
   calls `settleOfframp(requestId, path, minAmountOut)` from the authorized `settler` address.
   - Swaps the locked token into `stableToken` via PancakeSwap's `swapExactTokensForTokens`.
   - Reverts with `RateExpired` if called after `deadline` — the request stays `Locked`.
3. If settlement doesn't happen in time, **anyone** (including the user) can call
   `refund(requestId)` after `deadline` to return the locked funds. This is the state-desync
   mitigation from PRD Section 5.3.
4. `getLatestBnbUsdPrice()` exposes the Chainlink BNB/USD feed on-chain, mirroring the rate the
   frontend fetches directly in PRD Section 5.1 step 2.

**Trust boundary, stated explicitly (PRD Section 5.3):** once a request is `Settled`, the stable
tokens go to `owner()` for the (simulated, in the hackathon build) fiat conversion and
disbursement legs. The escrow itself is non-custodial, but that handoff is not "fully
trustless" — this is a known, documented limitation, not a hidden one.

## Deployed — BSC Testnet (chain ID 97)

Machine-readable copy: [`deployments/bscTestnet.json`](deployments/bscTestnet.json).

| Contract | Address |
|---|---|
| `SakuOfframpEscrow` | [`0xe9Bc98E5Ac1942AbE4E79A4219868FF0351579A0`](https://testnet.bscscan.com/address/0xe9Bc98E5Ac1942AbE4E79A4219868FF0351579A0) |
| `MockStableToken` (mBUSD, 18 dec) | [`0xD12196E766F86F6Fc352d5CECe7637bCd9026a83`](https://testnet.bscscan.com/address/0xD12196E766F86F6Fc352d5CECe7637bCd9026a83) |
| `MockUSDC` (USDC, 6 dec) | [`0x3d2937A6cDb76a1B199b87302D112D584795d3b1`](https://testnet.bscscan.com/address/0x3d2937A6cDb76a1B199b87302D112D584795d3b1) |

Owner and `settler` are both the deployer `0x4B718eE56D2217fcd4315433B32C95DdC220b2AB`.

### Liquidity is a prerequisite for settlement

`settleOfframp` swaps through the real PancakeSwap Testnet router, so the
`lockedToken -> stableToken` pair must actually exist and hold liquidity — otherwise every
settlement reverts inside the router while `lock` and `refund` keep working, which looks like
a contract bug but isn't. The demo pair was seeded 1:1 with 100,000 of each token:

| | |
|---|---|
| PancakeSwap V2 factory | `0x6725F303b657a9451d8BA641348b6761A6CC7a17` |
| USDC/mBUSD pair | [`0xF032B04A93621dE9fe9c8eaFB209bE1012d765dE`](https://testnet.bscscan.com/address/0xF032B04A93621dE9fe9c8eaFB209bE1012d765dE) |

### Live testnet run (PRD Section 5.1)

Both branches of the flow were exercised on-chain, not just in the Hardhat suite:

| Branch | Result | Tx |
|---|---|---|
| lock -> settle | 10 USDC swapped to 9.979004 mBUSD, status `Settled` | [`0xab9e00a4`](https://testnet.bscscan.com/tx/0xab9e00a4a958e5c6e5d2e90d68845d0a4d269b8b3893e7bc2429b0d05b10af26) |
| lock -> expiry -> refund | 10 USDC returned in full, status `Refunded` | [`0x44be7a01`](https://testnet.bscscan.com/tx/0x44be7a01ac762c5394b26f24b049a15caba43dcea4d85ee2de7b1144b953284a) |

Settling after `deadline` reverts with `RateExpired` and leaves the request `Locked`, so
`refund` stays available — the PRD Section 5.3 state-desync mitigation, confirmed on testnet.

## Setup

```bash
npm install
cp .env.example .env   # fill in PRIVATE_KEY, RPC URL, etc.
npx hardhat compile
npx hardhat test
```

## Deploying to BSC Testnet

Get tBNB from the [BNB Chain testnet faucet](https://www.bnbchain.org/en/testnet-faucet), then:

```bash
# 1. A stable settlement token is required (STABLE_TOKEN_ADDRESS in .env).
#    Use a real BUSD-pegged testnet token, or deploy MockStableToken for a demo:
npx hardhat run scripts/deployMockUSDC.ts --network bscTestnet   # example ERC20 to lock

# 2. Deploy the escrow (reads PANCAKE_ROUTER_ADDRESS / CHAINLINK_BNBUSD_FEED /
#    STABLE_TOKEN_ADDRESS / SETTLER_ADDRESS from .env — see scripts/deployOfframpEscrow.ts
#    for the default testnet addresses and where to verify them):
npm run deploy:escrow
```

Verify on BscScan:

```bash
npx hardhat verify --network bscTestnet <address> <constructor-arg-1> <constructor-arg-2> ...
```

> ⚠️ The PancakeSwap Router and Chainlink BNB/USD feed addresses in `scripts/deployOfframpEscrow.ts`
> are the commonly published BSC Testnet addresses as of this writing. Testnet infrastructure
> addresses can change — verify against the
> [PancakeSwap docs](https://docs.pancakeswap.finance/developers/smart-contracts/pancakeswap-exchange/v2-contracts)
> and [Chainlink BNB Chain feed addresses](https://docs.chain.link/data-feeds/price-feeds/addresses?network=bnb-chain)
> before deploying.

## Network

- **Chain:** BNB Smart Chain Testnet (`bscTestnet`, chain ID `97`)
- **Explorer:** https://testnet.bscscan.com
- Configure `BSC_TESTNET_RPC_URL` / `PRIVATE_KEY` / `BSCSCAN_API_KEY` in `.env` (see `.env.example`).
- The `data-seed-prebsc-*.binance.org` endpoints that used to be the default now refuse
  connections; `https://bsc-testnet-rpc.publicnode.com` is the working default.

/**
 * On-chain configuration for Saku v2 (PRD Section 4).
 *
 * v1 pointed at Arbitrum Sepolia and an IDRX/registry/staking stack whose contracts no longer
 * exist. Everything here is BSC Testnet, and the addresses come from
 * `contract/deployments/bscTestnet.json`.
 */

export const NETWORK_CONFIG = {
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 97),
  name: 'BNB Smart Chain Testnet',
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || 'https://bsc-testnet-rpc.publicnode.com',
  blockExplorer: process.env.NEXT_PUBLIC_BLOCK_EXPLORER || 'https://testnet.bscscan.com',
  nativeCurrency: { name: 'tBNB', symbol: 'tBNB', decimals: 18 },
} as const;

export const CONTRACTS = {
  /** SakuOfframpEscrow — PRD Section 5 Lock & Release escrow. */
  ESCROW: process.env.NEXT_PUBLIC_ESCROW_ADDRESS || '',
  /** MockUSDC — the token a user locks in the offramp demo. */
  USDC: process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS || '',
  /** MockStableToken (mBUSD) — what the escrow swaps into on settlement. */
  STABLE: process.env.NEXT_PUBLIC_STABLE_TOKEN_ADDRESS || '',
} as const;

/**
 * Tokens the wallet screen shows a balance for.
 *
 * USDC only, deliberately. mBUSD (`CONTRACTS.STABLE`) is not a currency the user holds — it is
 * what the escrow swaps *into* during an off-ramp (PRD 5.1 step 6) before the stable tokens are
 * handed off for fiat conversion. It passes through the contract, never through a user's
 * wallet, so listing it as a balance line was showing plumbing as if it were money.
 */
export const TOKENS = [
  { symbol: 'USDC', address: CONTRACTS.USDC, decimals: 6 },
] as const;

/**
 * Allowance granted when approving a Saku contract, so the approval is signed once instead of
 * before every transfer.
 *
 * The measured cost of the extra step is not the chain — an approval mines in about two seconds
 * on BSC Testnet. It is the MPC signature in front of it, which is the latency PRD Section 9
 * flags as an open risk. Removing the signature is the only part anyone can actually feel.
 *
 * The trade-off, stated rather than buried: the escrow and staking contracts can then pull that
 * token without asking again. Both are non-upgradeable, and both only ever move tokens inside a
 * call the user themselves signed (`lockForOfframp`, `stake`) — the allowance is not a standing
 * permission to move funds unprompted. A user who wants it gone can revoke it like any other
 * ERC20 approval.
 */
export const MAX_APPROVAL = (BigInt(1) << BigInt(256)) - BigInt(1);

export function explorerAddressUrl(address: string): string {
  return `${NETWORK_CONFIG.blockExplorer}/address/${address}`;
}

export function explorerTxUrl(hash: string): string {
  return `${NETWORK_CONFIG.blockExplorer}/tx/${hash}`;
}

/**
 * Poll for receipts at roughly one block, not ethers' 4-second default.
 *
 * BSC testnet produces a block every ~0.45s. Waiting 4s between `eth_getTransactionReceipt`
 * calls means `tx.wait()` spends most of its time sitting on a transaction that was mined
 * almost immediately — measured as 2-4 seconds of pure dead air on every transfer, top up,
 * packet and split-bill payment in the app.
 *
 * 500ms costs a handful of extra RPC calls per transaction and gets that back.
 */
export const RECEIPT_POLLING_MS = 500;

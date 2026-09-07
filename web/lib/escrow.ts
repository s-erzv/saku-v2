/**
 * SakuOfframpEscrow — the PRD Section 5 cross-rail flow, server side.
 *
 * The user locks tokens themselves (their MPC signature, their transaction). Everything here is
 * the settler's half: watching what they locked, swapping it on PancakeSwap, and refunding when
 * the rate-lock expires before that happens.
 *
 * The timing is the hard part. `lockForOfframp` fixes a deadline 30-120 seconds out, and
 * `settleOfframp` reverts with `RateExpired` past it — deliberately, so a stale rate can never
 * settle. Settlement therefore runs immediately after the lock is observed, not on a schedule.
 */

import { Contract, type ContractTransactionReceipt } from 'ethers';
import { getProvider, getSettler } from '@/lib/chain';

export const ESCROW_ABI = [
  'function lockForOfframp(uint256 amount, address token, bytes32 recipientPhoneHash, uint256 rateExpiry) external returns (bytes32)',
  'function settleOfframp(bytes32 requestId, address[] path, uint256 minAmountOut) external returns (uint256)',
  'function refund(bytes32 requestId) external',
  'function getRequest(bytes32 requestId) view returns (tuple(address user, address token, uint256 amount, bytes32 recipientPhoneHash, uint256 deadline, uint8 status))',
  'function getLatestBnbUsdPrice() view returns (int256 price, uint8 decimals, uint256 updatedAt)',
  'event OfframpRequested(address indexed user, uint256 amount, address indexed token, bytes32 indexed recipientHash, bytes32 requestId, uint256 deadline)',
  'event OfframpSettled(bytes32 indexed requestId, uint256 amountIn, uint256 amountOut)',
  'event OfframpRefunded(bytes32 indexed requestId, address indexed user, uint256 amount)',
] as const;

const ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])',
] as const;

/** PancakeSwap V2 router on BSC Testnet — the address the escrow was deployed against. */
const PANCAKE_ROUTER = '0xD99D1c33F9fC3444f8101754aBC46c52416550D1';

/**
 * How long the locked rate stays valid.
 *
 * The contract allows 30-120s. Taking the maximum on purpose: settlement has to fit a swap plus
 * two RPC round trips inside it, and a lock that expires before the settler can act turns a
 * working payment into a refund the user has to wait out.
 */
export const RATE_EXPIRY_SECONDS = 120;

/** Tolerated slippage on the settlement swap, in basis points (1%). */
const SLIPPAGE_BPS = 100;

export function getEscrowAddress(): string {
  const address = process.env.NEXT_PUBLIC_ESCROW_ADDRESS?.trim();
  if (!address) throw new Error('NEXT_PUBLIC_ESCROW_ADDRESS is not set');
  return address;
}

export function getStableTokenAddress(): string {
  const address = process.env.NEXT_PUBLIC_STABLE_TOKEN_ADDRESS?.trim();
  if (!address) throw new Error('NEXT_PUBLIC_STABLE_TOKEN_ADDRESS is not set');
  return address;
}

export function getEscrowAsSettler(): Contract {
  return new Contract(getEscrowAddress(), ESCROW_ABI, getSettler());
}

export function getEscrowReadOnly(): Contract {
  return new Contract(getEscrowAddress(), ESCROW_ABI, getProvider());
}

/**
 * What the swap would return right now, and the floor to accept.
 *
 * `minAmountOut` is not optional politeness: passing 0 would let the settlement execute against
 * any price, including one moved by a sandwich in the same block.
 */
export async function quoteSwap(
  tokenIn: string,
  amountIn: bigint
): Promise<{ path: string[]; expectedOut: bigint; minAmountOut: bigint }> {
  const router = new Contract(PANCAKE_ROUTER, ROUTER_ABI, getProvider());
  const path = [tokenIn, getStableTokenAddress()];

  const amounts: bigint[] = await router.getAmountsOut(amountIn, path);
  const expectedOut = amounts[amounts.length - 1];
  const minAmountOut = (expectedOut * BigInt(10_000 - SLIPPAGE_BPS)) / BigInt(10_000);

  return { path, expectedOut, minAmountOut };
}

/** Settle a locked request. Throws if the rate-lock window has already closed. */
export async function settleOfframp(
  requestId: string,
  tokenIn: string,
  amountIn: bigint
): Promise<{ receipt: ContractTransactionReceipt; amountOut: bigint }> {
  const { path, minAmountOut } = await quoteSwap(tokenIn, amountIn);

  const escrow = getEscrowAsSettler();
  const tx = await escrow.settleOfframp(requestId, path, minAmountOut);
  const receipt = (await tx.wait()) as ContractTransactionReceipt;

  // Read the settled amount back off the event rather than trusting the quote — the swap can
  // land anywhere between minAmountOut and the quote.
  const parsed = receipt.logs
    .map((log) => {
      try {
        return escrow.interface.parseLog({ topics: [...log.topics], data: log.data });
      } catch {
        return null;
      }
    })
    .find((entry) => entry?.name === 'OfframpSettled');

  return { receipt, amountOut: parsed ? BigInt(parsed.args[2]) : BigInt(0) };
}

/**
 * Unlock a request whose rate expired before it settled.
 *
 * Permissionless on-chain (PRD Section 5.3), so this is a convenience: the user could call it
 * themselves, but they should not have to notice that they need to.
 */
export async function refundOfframp(requestId: string): Promise<ContractTransactionReceipt> {
  const escrow = getEscrowAsSettler();
  const tx = await escrow.refund(requestId);
  return (await tx.wait()) as ContractTransactionReceipt;
}

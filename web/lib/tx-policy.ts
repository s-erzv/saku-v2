/**
 * What `/api/mpc/sign` is allowed to sign.
 *
 * The route used to accept any hex blob that parsed as a transaction and hand it to the signing
 * provider. Since a valid session is the only thing gating that route, "any blob" meant a single
 * request could move a user's whole balance to an address of the caller's choosing, or interact
 * with a contract this app has never heard of, or sign for a different chain entirely.
 *
 * This module is the answer to "what did the user actually ask for?", asked on the server, where
 * the client cannot lie about it. Every transaction Saku legitimately produces is one of a very
 * small set of calls (see `hooks/useTransfer.ts`, `useOfframp.ts`, `useStaking.ts`,
 * `usePacket.ts`, `useQrPayment.ts`, `useSplitBill.ts`, `useWarmApproval.ts`):
 *
 *   USDC.transfer(to, amount)      — pay a person, the treasury, or a bill's creator
 *   USDC.approve(spender, amount)  — spender is the escrow or the staking pool, nothing else
 *   ESCROW.lockForOfframp(...)     — start an off-ramp
 *   STAKING.stake/unstake/claimRewards/exit
 *
 * Nothing else, and never with native value attached — the user's wallet holds tBNB only for
 * gas, which `lib/gas.ts` drips from the settler.
 *
 * What this does and does not buy, stated plainly. It removes the "sign an arbitrary blob" class
 * outright: no unknown contracts, no other chains, no native drain, no approving an attacker as
 * a spender. It does **not** stop a caller who already holds a live session from calling
 * `transfer` to an address they control — paying an arbitrary address is what a wallet is for,
 * so that one is bounded by {@link lib/spend-limits} instead, and made visible by the audit log.
 * The root fix for a stolen session is that the session is no longer readable by script at all
 * (`lib/session.ts`).
 */

import { Interface, Transaction, getAddress } from 'ethers';
import { CHAIN_ID } from '@/lib/chain';

/** A transaction that fails policy. The message is safe to show a user. */
export class TxPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TxPolicyError';
  }
}

/**
 * Ceiling on gas the caller may ask to be signed for.
 *
 * Not a security boundary on its own — the chain enforces the real cost — but a transaction
 * claiming ten million gas is not one of ours, and refusing it costs nothing.
 */
const MAX_GAS_LIMIT = BigInt(2_000_000);

const erc20 = new Interface([
  'function transfer(address to, uint256 amount)',
  'function approve(address spender, uint256 amount)',
]);

const escrow = new Interface([
  'function lockForOfframp(uint256 amount, address token, bytes32 recipientPhoneHash, uint256 rateExpiry)',
]);

const staking = new Interface([
  'function stake(uint256 amount)',
  'function unstake(uint256 amount)',
  'function claimRewards()',
  'function exit()',
]);

/** `getAddress` normalises to checksum form and throws on anything that is not an address. */
function normalise(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return getAddress(value);
  } catch {
    return null;
  }
}

interface Destinations {
  usdc: string | null;
  escrow: string | null;
  staking: string | null;
}

/**
 * The contracts this deployment will sign for, read at call time rather than at module load so a
 * missing env var surfaces as a refusal on the request that needed it, not as an import-time
 * crash that takes down every route in the file.
 */
function destinations(): Destinations {
  return {
    usdc: normalise(process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS),
    escrow: normalise(process.env.NEXT_PUBLIC_ESCROW_ADDRESS),
    staking: normalise(process.env.NEXT_PUBLIC_STAKING_ADDRESS),
  };
}

export interface SignedIntent {
  /** Which of Saku's contracts this call targets. */
  contract: 'usdc' | 'escrow' | 'staking';
  /** Canonical method name, for the audit log. */
  method: string;
  /** Checksummed `to` of the transaction itself (the contract address). */
  to: string;
  /**
   * USDC leaving the wallet, in base units, or zero for calls that move no token out —
   * `approve` grants an allowance rather than spending, and unstaking/claiming move value in.
   * This is what {@link lib/spend-limits} counts.
   */
  usdcOut: bigint;
  /** Recipient of a `transfer`, or spender of an `approve`. Null for the rest. */
  counterparty: string | null;
}

/**
 * Parse and vet an unsigned transaction.
 *
 * @throws TxPolicyError with a message safe to return to the caller.
 */
export function assertSignable(unsignedTransactionHex: string): SignedIntent {
  let tx: Transaction;
  try {
    tx = Transaction.from(
      unsignedTransactionHex.startsWith('0x')
        ? unsignedTransactionHex
        : `0x${unsignedTransactionHex}`
    );
  } catch {
    throw new TxPolicyError('That transaction could not be read.');
  }

  // A transaction signed for one chain is valid on any chain that shares the signature scheme
  // and does not pin the id, so this is a real boundary rather than a sanity check.
  if (Number(tx.chainId) !== CHAIN_ID) {
    throw new TxPolicyError('That transaction is for a different network.');
  }

  // The user's wallet holds native currency only for gas, sponsored by `lib/gas.ts`. A native
  // transfer out of it is never something Saku asked for.
  if ((tx.value ?? BigInt(0)) !== BigInt(0)) {
    throw new TxPolicyError('Saku does not send the network currency.');
  }

  if ((tx.gasLimit ?? BigInt(0)) > MAX_GAS_LIMIT) {
    throw new TxPolicyError('That transaction asks for more gas than Saku signs for.');
  }

  const to = normalise(tx.to);
  if (!to) {
    // No `to` is a contract deployment.
    throw new TxPolicyError('Saku does not deploy contracts.');
  }

  const known = destinations();
  const data = tx.data ?? '0x';

  if (to === known.usdc) return vetErc20(to, data);
  if (known.escrow && to === known.escrow) return vetEscrow(to, data);
  if (known.staking && to === known.staking) return vetStaking(to, data);

  throw new TxPolicyError('Saku only signs for its own contracts.');
}

function vetErc20(to: string, data: string): SignedIntent {
  const parsed = erc20.parseTransaction({ data });
  if (!parsed) throw new TxPolicyError('That token call is not one Saku makes.');

  if (parsed.name === 'transfer') {
    const recipient = normalise(parsed.args[0] as string);
    if (!recipient) throw new TxPolicyError('That transfer has no valid recipient.');
    return {
      contract: 'usdc',
      method: 'transfer',
      to,
      usdcOut: BigInt(parsed.args[1] as bigint),
      counterparty: recipient,
    };
  }

  // An approval is where a stolen session would do the most damage most quietly: approve an
  // attacker's address for the maximum and drain at leisure, with the signature long forgotten.
  // Saku only ever approves two contracts, both its own.
  const spender = normalise(parsed.args[0] as string);
  const known = destinations();
  if (!spender || (spender !== known.escrow && spender !== known.staking)) {
    throw new TxPolicyError('Saku only approves its own contracts to spend your balance.');
  }

  return {
    contract: 'usdc',
    method: 'approve',
    to,
    // An allowance is not a spend. What it enables is counted when the escrow or the staking
    // pool actually pulls, which is a call this policy also sees.
    usdcOut: BigInt(0),
    counterparty: spender,
  };
}

function vetEscrow(to: string, data: string): SignedIntent {
  const parsed = escrow.parseTransaction({ data });
  if (!parsed) throw new TxPolicyError('That escrow call is not one Saku makes.');

  const token = normalise(parsed.args[1] as string);
  if (!token || token !== destinations().usdc) {
    throw new TxPolicyError('That off-ramp locks a token Saku does not handle.');
  }

  return {
    contract: 'escrow',
    method: 'lockForOfframp',
    to,
    usdcOut: BigInt(parsed.args[0] as bigint),
    counterparty: null,
  };
}

function vetStaking(to: string, data: string): SignedIntent {
  const parsed = staking.parseTransaction({ data });
  if (!parsed) throw new TxPolicyError('That staking call is not one Saku makes.');

  return {
    contract: 'staking',
    method: parsed.name,
    to,
    // Only `stake` moves USDC out of the wallet. `unstake`, `claimRewards` and `exit` bring it
    // back, and counting those against a spending cap would lock someone out of their own funds.
    usdcOut: parsed.name === 'stake' ? BigInt(parsed.args[0] as bigint) : BigInt(0),
    counterparty: null,
  };
}

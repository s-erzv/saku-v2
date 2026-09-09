'use client';

/**
 * Collecting the platform fee on an on-chain movement.
 *
 * The fee is a **second transfer to the treasury**, sent after the real one has landed. There is
 * no fee-splitting contract, so this is the only way to charge a fee that is genuinely added on
 * top rather than skimmed off what the recipient gets.
 *
 * The ordering is the whole point, and it is deliberate:
 *
 *   1. the recipient's transfer, then
 *   2. the fee.
 *
 * Either leg can fail. Doing it this way, a failure after step 1 means the user got their
 * transfer through and Saku did not collect — a cost to the business. Doing it the other way
 * round, a failure after step 1 would mean the user paid a fee for a transfer that never
 * happened — a cost to the user. Between a business losing 0.3% and a user losing money for
 * nothing, only one of those is acceptable.
 *
 * For the same reason a failed fee leg never throws: the money the user actually cared about has
 * already moved, and turning that into an error message would report a successful payment as
 * broken.
 */

import { Contract, type Signer } from 'ethers';

const ERC20_ABI = ['function transfer(address to, uint256 amount) returns (bool)'];

/** Cached per page load — the treasury address does not change between two transfers. */
let treasuryCache: string | null = null;

export async function getTreasuryAddress(token: string | null): Promise<string | null> {
  if (treasuryCache) return treasuryCache;
  if (!token) return null;

  try {
    const res = await fetch('/api/treasury', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const { treasury } = (await res.json()) as { treasury?: string };
    treasuryCache = treasury ?? null;
    return treasuryCache;
  } catch {
    return null;
  }
}

/**
 * Send the fee, after the transfer it belongs to has already confirmed.
 *
 * Returns the fee transaction's hash, or null if it could not be sent. Never throws — see the
 * module comment for why a failure here must not surface as a failed payment.
 */
export async function chargePlatformFee({
  signer,
  usdcAddress,
  treasury,
  feeUnits,
}: {
  signer: Signer;
  usdcAddress: string;
  treasury: string | null;
  feeUnits: bigint;
}): Promise<string | null> {
  if (!treasury || feeUnits <= BigInt(0)) return null;

  try {
    const usdc = new Contract(usdcAddress, ERC20_ABI, signer);
    const tx = await usdc.transfer(treasury, feeUnits);
    // Not awaited to completion on purpose: the user is already looking at a confirmed payment,
    // and making them wait a second block for Saku's own fee would be charging them twice — once
    // in money and once in time.
    return tx.hash as string;
  } catch (error) {
    console.error('[fee] could not collect the platform fee:', error);
    return null;
  }
}

/**
 * Gas sponsorship.
 *
 * A wallet signs its own transactions, which means it needs its own gas — and the
 * user this app is designed for (PRD Section 3, "Rani") has never heard of tBNB. Saku funds a
 * new wallet with just enough to transact, from the settler.
 *
 * This is a spending faucet pointed at the settler's balance, so the guards matter more than
 * the feature. Three of them, in order of how much they protect:
 *
 *  1. The caller must already hold a verified session — this module is only reachable from
 *     routes that check the token first.
 *  2. A wallet is only funded when it is actually short, so a funded wallet costs nothing.
 *  3. Per-wallet caps on count and frequency, held in the database, so a loop of re-logins
 *     cannot drain the settler even with a valid session.
 */

import { formatEther, parseEther } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { CHAIN_ID, getProvider, getSettler } from '@/lib/chain';

/**
 * ~0.005 tBNB. A BEP20 transfer costs roughly 0.00015 tBNB at testnet gas prices, so this is
 * around 30 transactions — enough to demo without topping up, small enough that a leak is
 * survivable.
 */
const DRIP_AMOUNT = parseEther('0.005');

/** Below this, a wallet is considered unable to transact. */
const MIN_BALANCE = parseEther('0.002');

/** Per-wallet lifetime cap, and the minimum gap between drips. */
const MAX_DRIPS_PER_WALLET = 10;
const MIN_HOURS_BETWEEN_DRIPS = 1;

/** Leave a floor in the settler so it can still settle off-ramps if the faucet is abused. */
const SETTLER_RESERVE = parseEther('0.05');

export type GasDripResult =
  | { status: 'funded'; txHash: string }
  | { status: 'not_needed' }
  | { status: 'capped' }
  | { status: 'settler_low' }
  | { status: 'failed'; error: string };

/**
 * Fund `address` with gas if it needs it.
 *
 * Never throws: callers invoke this alongside wallet registration, and a faucet problem must
 * not fail the registration itself — the wallet is still valid, it just cannot pay for gas yet.
 */
export async function ensureGasFor(userId: string, address: string): Promise<GasDripResult> {
  try {
    const provider = getProvider();

    const balance = await provider.getBalance(address);
    if (balance >= MIN_BALANCE) return { status: 'not_needed' };

    const supabase = getSupabaseAdmin();
    const { data: wallet } = await supabase
      .from('wallets')
      .select('gas_drip_count, last_gas_drip_at')
      .eq('user_id', userId)
      .eq('chain_id', CHAIN_ID)
      .maybeSingle();

    const dripCount = wallet?.gas_drip_count ?? 0;
    if (dripCount >= MAX_DRIPS_PER_WALLET) return { status: 'capped' };

    if (wallet?.last_gas_drip_at) {
      const hoursSince = (Date.now() - new Date(wallet.last_gas_drip_at).getTime()) / 3_600_000;
      if (hoursSince < MIN_HOURS_BETWEEN_DRIPS) return { status: 'capped' };
    }

    const settler = getSettler();
    const settlerBalance = await provider.getBalance(settler.address);
    if (settlerBalance < SETTLER_RESERVE + DRIP_AMOUNT) return { status: 'settler_low' };

    // Record the drip before it is mined. If the process dies mid-send the user gets one fewer
    // free drip; the alternative — recording after — lets a crash loop send unbounded times.
    await supabase
      .from('wallets')
      .update({ gas_drip_count: dripCount + 1, last_gas_drip_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('chain_id', CHAIN_ID);

    const tx = await settler.sendTransaction({ to: address, value: DRIP_AMOUNT });
    await tx.wait();

    return { status: 'funded', txHash: tx.hash };
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : 'Gas drip failed' };
  }
}

/** For display: how much a fresh wallet is given, as a human-readable string. */
export const DRIP_AMOUNT_LABEL = `${formatEther(DRIP_AMOUNT)} tBNB`;

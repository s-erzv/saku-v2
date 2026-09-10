/**
 * Record a completed staking action in the history cache.
 *
 * Staking was the one money flow that never wrote a row. The tokens moved, the balance changed,
 * and the history said nothing had happened — see `db/migrations/20260910_add_staking_transaction_types.sql`.
 *
 * Same contract as `/api/transfer/record`: the client sends a transaction hash and nothing else
 * worth believing. What gets written is read back off the receipt.
 *
 * What it reads, though, is different, and the difference matters. A transfer can be recovered
 * from its ERC20 `Transfer` log, but `SakuStaking.stake` and `.unstake` both harvest pending
 * rewards in the same call, so one staking transaction can emit two token transfers — and for an
 * unstake both of them run from the contract to the same user. Picking a `Transfer` log would
 * mean a coin flip between the principal and the reward. The contract says which is which in its
 * own events, so those are what this route parses.
 */

import { NextResponse } from 'next/server';
import { Interface, getAddress } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';
import { recordTransaction } from '@/lib/record-transaction';
import { CHAIN_ID, getProvider, getUsdcAddress } from '@/lib/chain';

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

const STAKING_EVENTS = new Interface([
  'event Staked(address indexed user, uint256 amount)',
  'event Unstaked(address indexed user, uint256 amount)',
  'event RewardsClaimed(address indexed user, uint256 amount)',
]);

/** Read at call time, so a missing address is a refusal here rather than an import-time crash. */
function stakingAddress(): string | null {
  const raw = process.env.NEXT_PUBLIC_STAKING_ADDRESS?.trim();
  if (!raw) return null;
  try {
    return getAddress(raw).toLowerCase();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  const staking = stakingAddress();
  if (!staking) {
    return NextResponse.json({ error: 'Staking is not configured' }, { status: 503 });
  }

  let txHash: string;
  try {
    const body = await request.json();
    const value = (body as { txHash?: unknown })?.txHash;
    if (typeof value !== 'string' || !TX_HASH.test(value)) throw new Error('bad hash');
    txHash = value.toLowerCase();
  } catch {
    return NextResponse.json({ error: 'A transaction hash is required' }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: wallet } = await supabase
      .from('wallets')
      .select('address')
      .eq('user_id', session.userId)
      .eq('chain_id', CHAIN_ID)
      .maybeSingle();

    if (!wallet?.address) {
      return NextResponse.json({ error: 'No wallet for this session' }, { status: 400 });
    }
    const myAddress = wallet.address.toLowerCase();

    const receipt = await getProvider().getTransactionReceipt(txHash);
    if (!receipt) return NextResponse.json({ error: 'Transaction not found yet' }, { status: 404 });
    if (receipt.status !== 1) {
      return NextResponse.json({ error: 'Transaction reverted on-chain' }, { status: 400 });
    }

    // Only this contract's own logs, and only the ones about this session's user. A caller who
    // posts somebody else's staking hash gets nothing written.
    const events = receipt.logs
      .filter((entry) => entry.address.toLowerCase() === staking)
      .map((entry) => {
        try {
          return STAKING_EVENTS.parseLog({ topics: [...entry.topics], data: entry.data });
        } catch {
          return null;
        }
      })
      .filter((parsed): parsed is NonNullable<typeof parsed> => parsed !== null)
      .filter((parsed) => String(parsed.args[0]).toLowerCase() === myAddress);

    const amountOf = (name: string) => {
      const found = events.find((parsed) => parsed.name === name);
      return found ? BigInt(found.args[1]).toString() : null;
    };

    const staked = amountOf('Staked');
    const unstaked = amountOf('Unstaked');
    const reward = amountOf('RewardsClaimed');

    // Principal first, because that is the movement the user chose to make. A reward harvested
    // on the way through is real money too, so it is kept rather than dropped — just not as the
    // headline, since only one row may exist per transaction.
    const action = staked
      ? { type: 'stake' as const, amount: staked, out: true }
      : unstaked
        ? { type: 'unstake' as const, amount: unstaked, out: false }
        : reward
          ? { type: 'stake_reward' as const, amount: reward, out: false }
          : null;

    if (!action) {
      return NextResponse.json(
        { error: 'This transaction did not stake, unstake or claim for your wallet' },
        { status: 400 }
      );
    }

    // The addresses decide direction when the history is read back, so they have to describe the
    // movement rather than the caller — see `directionFor` in `app/api/transactions`.
    const record = await recordTransaction(supabase, {
      tx_hash: txHash,
      chain_id: CHAIN_ID,
      type: action.type,
      status: 'confirmed',
      from_address: action.out ? myAddress : staking,
      to_address: action.out ? staking : myAddress,
      token_address: getUsdcAddress().toLowerCase(),
      amount: action.amount,
      user_id: session.userId,
      block_number: receipt.blockNumber,
      // Only when a reward rode along with a principal movement; a bare claim already has it as
      // the amount and would be saying the same number twice.
      context:
        reward && action.type !== 'stake_reward'
          ? { kind: action.type, harvestedReward: reward }
          : { kind: action.type },
    });

    return NextResponse.json({
      recorded: record.recorded,
      duplicate: record.duplicate,
      type: action.type,
    });
  } catch (error) {
    console.error('[staking/record]', error);
    return NextResponse.json({ error: 'Could not record this transaction' }, { status: 500 });
  }
}

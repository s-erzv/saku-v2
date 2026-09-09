/**
 * Split bills: create one (POST), list the ones that concern you (GET).
 *
 * "Concern you" means two things — bills you created, and bills where you are on the hook for a
 * share. The second is matched by phone hash, so a bill can be created for someone before they
 * have joined Saku and still find them when they do.
 *
 * No money moves here and none is held. A share is a record of who owes what; paying it is an
 * ordinary transfer the participant signs themselves, filed afterwards via
 * `/api/split-bill/[id]/pay`.
 */

import { NextResponse } from 'next/server';
import { formatUnits, parseUnits } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';
import { CHAIN_ID, USDC_DECIMALS, getUsdcAddress } from '@/lib/chain';
import { hashPhone, InvalidPhoneNumberError } from '@/lib/phone';
import { describeDbError } from '@/lib/db-errors';

/** `lib/phone.ts` emits keccak256 hex; anything else was not produced by this app. */
const PHONE_HASH = /^0x[0-9a-fA-F]{64}$/;

const MAX_PARTICIPANTS = 30;

interface ParticipantInput {
  /** A typed-in number. Absent when the participant came from the address book. */
  phone?: string;
  /**
   * A saved contact's phone hash. The address book holds a label and a hash server-side and the
   * number only in the cache of whichever device saved it, so requiring a number here would make
   * contacts unusable for this from every other device.
   */
  phoneHash?: string;
  label?: string;
  /** Optional explicit share; when absent the remainder is split evenly. */
  amount?: number;
  /**
   * This person's slice of the receipt, in the receipt's own currency — what they ordered, their
   * share of tax and service. Stored verbatim for the bill screen to explain `amount` with; it
   * is never used to compute anything, so a client that gets it wrong misleads only itself.
   */
  breakdown?: unknown;
}

async function requireSession(request: Request) {
  const sessionToken = extractTokenFromHeader(request.headers.get('authorization'));
  if (!sessionToken) return null;
  try {
    return await verifyToken(sessionToken);
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const supabase = getSupabaseAdmin();

    const [{ data: created }, { data: owed }] = await Promise.all([
      supabase
        .from('split_bills')
        .select('id, title, total_amount, status, created_at')
        .eq('creator_id', session.userId)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('split_bill_shares')
        .select('id, bill_id, amount, status, split_bills(id, title, creator_id, created_at)')
        .eq('participant_phone_hash', session.phoneHash)
        .order('id', { ascending: false })
        .limit(30),
    ]);

    // One lookup for every name this page needs, not one per bill.
    const creatorIds = [
      ...new Set(
        (owed ?? [])
          .map((s) => (s.split_bills as unknown as { creator_id?: string })?.creator_id)
          .filter((id): id is string => Boolean(id))
      ),
    ];

    const creatorNames = new Map<string, string>();
    if (creatorIds.length > 0) {
      const { data: creators } = await supabase
        .from('users')
        .select('id, display_name')
        .in('id', creatorIds);
      for (const user of creators ?? []) {
        if (user.display_name) creatorNames.set(user.id, user.display_name);
      }
    }

    return NextResponse.json({
      created: (created ?? []).map((b) => ({
        id: b.id,
        title: b.title,
        totalAmount: formatUnits(b.total_amount, USDC_DECIMALS),
        status: b.status,
        createdAt: b.created_at,
      })),
      owed: (owed ?? [])
        // A share whose bill was deleted is not something to render.
        .filter((s) => s.split_bills)
        .map((s) => {
          const bill = s.split_bills as unknown as {
            id: string;
            title: string;
            creator_id: string;
            created_at: string;
          };
          return {
            shareId: s.id,
            billId: s.bill_id,
            title: bill.title,
            amount: formatUnits(s.amount, USDC_DECIMALS),
            status: s.status,
            createdAt: bill.created_at,
            // Who is asking. A bill that arrives without a name is just a number demanding money.
            fromName: creatorNames.get(bill.creator_id) ?? null,
          };
        }),
    });
  } catch (error) {
    const { message, isSchemaDrift, code } = describeDbError(error, 'Could not load bills');
    console.error('[split-bill:GET]', code ?? '', message);
    return NextResponse.json({ error: message, schemaOutOfDate: isSchemaDrift || undefined }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const total = Number(body.totalAmount);
    const participants: ParticipantInput[] = Array.isArray(body.participants) ? body.participants : [];

    if (title.length < 1 || title.length > 80) {
      return NextResponse.json({ error: 'Title must be 1-80 characters' }, { status: 400 });
    }
    if (!Number.isFinite(total) || total <= 0) {
      return NextResponse.json({ error: 'Invalid total' }, { status: 400 });
    }
    if (participants.length < 1 || participants.length > MAX_PARTICIPANTS) {
      return NextResponse.json({ error: `Add between 1 and ${MAX_PARTICIPANTS} people` }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: wallet } = await supabase
      .from('wallets')
      .select('address')
      .eq('user_id', session.userId)
      .eq('chain_id', CHAIN_ID)
      .maybeSingle();

    if (!wallet?.address) {
      return NextResponse.json({ error: 'Finish setting up your wallet first' }, { status: 400 });
    }

    // Hash every participant, rejecting the whole bill if any number is unusable — a bill with
    // a silently dropped participant is worse than one that failed to save.
    let hashed: { hash: string; label?: string; amount?: number; breakdown?: unknown }[];
    try {
      hashed = participants.map((p) => ({
        hash:
          typeof p.phoneHash === 'string' && PHONE_HASH.test(p.phoneHash)
            ? p.phoneHash
            : hashPhone(String(p.phone ?? ''), body.countryCode || '62'),
        label: typeof p.label === 'string' ? p.label.slice(0, 64) : undefined,
        amount: Number.isFinite(Number(p.amount)) && Number(p.amount) > 0 ? Number(p.amount) : undefined,
        breakdown: p.breakdown ?? null,
      }));
    } catch (error) {
      if (error instanceof InvalidPhoneNumberError) {
        return NextResponse.json({ error: 'One of the numbers is invalid' }, { status: 400 });
      }
      throw error;
    }

    // Even split for anyone without an explicit share. The last of them absorbs the rounding
    // remainder so the shares always add up to the total exactly.
    const explicitTotal = hashed.reduce((sum, p) => sum + (p.amount ?? 0), 0);
    const remainder = total - explicitTotal;
    const evenCount = hashed.filter((p) => p.amount === undefined).length;

    if (remainder < 0) {
      return NextResponse.json({ error: 'Shares add up to more than the total' }, { status: 400 });
    }
    if (evenCount === 0 && remainder > 0) {
      return NextResponse.json({ error: 'Shares do not add up to the total' }, { status: 400 });
    }

    const totalUnits = parseUnits(total.toFixed(USDC_DECIMALS), USDC_DECIMALS);
    const remainderUnits = parseUnits(remainder.toFixed(USDC_DECIMALS), USDC_DECIMALS);

    let assignedEven = BigInt(0);
    let evenSeen = 0;

    const shares = hashed.map((p) => {
      if (p.amount !== undefined) {
        return {
          hash: p.hash,
          label: p.label,
          breakdown: p.breakdown,
          units: parseUnits(p.amount.toFixed(USDC_DECIMALS), USDC_DECIMALS),
        };
      }

      evenSeen += 1;
      const units =
        evenSeen === evenCount
          ? remainderUnits - assignedEven
          : remainderUnits / BigInt(evenCount);
      assignedEven += units;

      return { hash: p.hash, label: p.label, breakdown: p.breakdown, units };
    });

    const { data: bill, error: billError } = await supabase
      .from('split_bills')
      .insert({
        creator_id: session.userId,
        creator_address: wallet.address.toLowerCase(),
        title,
        total_amount: totalUnits.toString(),
        token_address: getUsdcAddress().toLowerCase(),
        // The receipt behind the total: line items, who had what, tax and service. Explains the
        // number; never used to derive it.
        breakdown: body.breakdown ?? null,
      })
      .select('id, title')
      .single();

    if (billError) throw billError;

    // Resolve participants who are already on Saku, so their app can find the bill by user id
    // as well as by hash.
    const { data: knownUsers } = await supabase
      .from('users')
      .select('id, phone_hash')
      .in('phone_hash', shares.map((s) => s.hash));

    const byHash = new Map((knownUsers ?? []).map((u) => [u.phone_hash, u.id]));

    const { error: sharesError } = await supabase.from('split_bill_shares').insert(
      shares.map((s) => ({
        bill_id: bill.id,
        participant_phone_hash: s.hash,
        participant_user_id: byHash.get(s.hash) ?? null,
        label: s.label ?? null,
        amount: s.units.toString(),
        breakdown: s.breakdown ?? null,
      }))
    );

    if (sharesError) {
      // Leaving a bill with no shares behind would be a row nobody can act on.
      await supabase.from('split_bills').delete().eq('id', bill.id);
      throw sharesError;
    }

    // Tell the ones who are already here — each with their own share, so the notification says
    // what they owe rather than only that a bill exists.
    const unitsByHash = new Map(shares.map((s) => [s.hash, s.units.toString()]));
    const notifiable = (knownUsers ?? []).filter((u) => u.id !== session.userId);
    if (notifiable.length > 0) {
      await supabase.from('notifications').insert(
        notifiable.map((u) => ({
          user_id: u.id,
          type: 'system' as const,
          message: `You were added to "${title}".`,
          metadata: { bill_id: bill.id, title, amount: unitsByHash.get(u.phone_hash) ?? null },
        }))
      );
    }

    return NextResponse.json({ success: true, billId: bill.id });
  } catch (error) {
    const { message, isSchemaDrift, code } = describeDbError(error, 'Could not create the bill');
    console.error('[split-bill:POST]', code ?? '', message);
    return NextResponse.json({ error: message, schemaOutOfDate: isSchemaDrift || undefined }, { status: 500 });
  }
}

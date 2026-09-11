/**
 * The caller's address book.
 *
 * `contacts` stores a label and a phone *hash*, never a number — so the server cannot show a
 * contact's number back, and a database breach yields no social graph of real phone numbers.
 * The client keeps its own local copy of the numbers it added for display; that trade-off is
 * documented on the table itself in the schema.
 *
 * Because of that, a contact created here comes back with the hash only. The UI shows the label.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';
import { InvalidPhoneNumberError, phoneHashCandidates } from '@/lib/phone';
import { findUserByPhone } from '@/lib/phone-identity';
import { describeDbError } from '@/lib/db-errors';

const requireSession = getSession;

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('contacts')
      .select('id, label, contact_phone_hash, contact_user_id, created_at')
      .eq('owner_id', session.userId)
      .order('label', { ascending: true });

    if (error) throw error;

    const rows = data ?? [];

    // The picture and the name a contact chose for themselves, for the ones who are on Saku.
    //
    // Its own query rather than a join: the list is a page of an address book, so this is one
    // extra round trip for the whole screen, and a PostgREST embed here would have to name the
    // foreign key constraint — which is a string this file would then be silently wrong about
    // if the schema were ever regenerated.
    //
    // The label still wins for the name. A contact is filed under what *this* user called them,
    // and replacing "Mum" with whatever she typed into her own profile would be a worse answer
    // to who the row is. The avatar has no such conflict, so it simply shows.
    const contactUserIds = [...new Set(rows.map((row) => row.contact_user_id).filter(Boolean))];
    const profiles = new Map<string, { avatarUrl: string | null; displayName: string | null }>();

    if (contactUserIds.length > 0) {
      const { data: people } = await supabase
        .from('users')
        .select('id, avatar_url, display_name')
        .in('id', contactUserIds);

      for (const person of people ?? []) {
        profiles.set(person.id, { avatarUrl: person.avatar_url, displayName: person.display_name });
      }
    }

    return NextResponse.json({
      contacts: rows.map((row) => {
        const profile = row.contact_user_id ? profiles.get(row.contact_user_id) : undefined;
        return {
          id: row.id,
          label: row.label,
          phoneHash: row.contact_phone_hash,
          // Whether this contact turned out to be a Saku user — decides if a direct transfer is
          // possible or the cross-rail path is needed.
          onSaku: !!row.contact_user_id,
          avatarUrl: profile?.avatarUrl ?? null,
          sakuName: profile?.displayName ?? null,
          createdAt: row.created_at,
        };
      }),
    });
  } catch (error) {
    const { message, isSchemaDrift, code } = describeDbError(error, 'Could not load contacts');
    console.error('[contacts:GET]', code ?? '', message);
    return NextResponse.json({ error: message, schemaOutOfDate: isSchemaDrift || undefined }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const label = typeof body.label === 'string' ? body.label.trim() : '';

    if (label.length < 1 || label.length > 64) {
      return NextResponse.json({ error: 'Name must be 1-64 characters' }, { status: 400 });
    }

    const dialCode: string = body.countryCode || '62';
    const rawPhone: string = body.phone;
    let candidates: Array<{ version: number; hash: string }>;
    try {
      candidates = phoneHashCandidates(rawPhone, dialCode);
    } catch (error) {
      if (error instanceof InvalidPhoneNumberError) {
        return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
      }
      throw error;
    }

    // What gets written is always version 2; a value stored now has no history to match.
    const phoneHash = candidates[0].hash;

    // The comparison, though, has to try both. The session carries whichever version this
    // account's own row still holds, so a user on version 1 adding their own number would slip
    // past a version 2 equality check.
    if (candidates.some((c) => c.hash === session.phoneHash)) {
      return NextResponse.json({ error: 'That is your own number' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Resolve now if they are on Saku, so the transfer screen does not have to look it up again.
    // Left NULL when they are not — and re-resolved on read is deliberately not done: a contact
    // joining Saku later is picked up the next time they are added or transferred to.
    // Version 2 first, version 1 as a fallback: a contact who has not signed in since the
    // pepper landed still has an unkeyed row, and reading them as "not on Saku" would file the
    // contact with a null `contact_user_id` that nothing ever re-resolves.
    const { user: existing } = await findUserByPhone(supabase, rawPhone, dialCode, 'id');

    const { data, error } = await supabase
      .from('contacts')
      .upsert(
        {
          owner_id: session.userId,
          label,
          contact_phone_hash: phoneHash,
          contact_user_id: existing?.id ?? null,
        },
        { onConflict: 'owner_id,contact_phone_hash' }
      )
      .select('id, label, contact_phone_hash, contact_user_id')
      .single();

    if (error) throw error;

    return NextResponse.json({
      success: true,
      contact: {
        id: data.id,
        label: data.label,
        phoneHash: data.contact_phone_hash,
        onSaku: !!data.contact_user_id,
      },
    });
  } catch (error) {
    const { message, isSchemaDrift, code } = describeDbError(error, 'Could not save contact');
    console.error('[contacts:POST]', code ?? '', message);
    return NextResponse.json({ error: message, schemaOutOfDate: isSchemaDrift || undefined }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await requireSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing contact id' }, { status: 400 });

    const supabase = getSupabaseAdmin();
    // Scoped by owner as well as id: an id alone must not be enough to delete someone else's row.
    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', id)
      .eq('owner_id', session.userId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Could not delete contact' }, { status: 500 });
  }
}

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
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';
import { hashPhone, InvalidPhoneNumberError } from '@/lib/phone';
import { describeDbError } from '@/lib/db-errors';

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
    const { data, error } = await supabase
      .from('contacts')
      .select('id, label, contact_phone_hash, contact_user_id, created_at')
      .eq('owner_id', session.userId)
      .order('label', { ascending: true });

    if (error) throw error;

    return NextResponse.json({
      contacts: (data ?? []).map((row) => ({
        id: row.id,
        label: row.label,
        phoneHash: row.contact_phone_hash,
        // Whether this contact turned out to be a Saku user — decides if a direct transfer is
        // possible or the cross-rail path is needed.
        onSaku: !!row.contact_user_id,
        createdAt: row.created_at,
      })),
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

    let phoneHash: string;
    try {
      phoneHash = hashPhone(body.phone, body.countryCode || '62');
    } catch (error) {
      if (error instanceof InvalidPhoneNumberError) {
        return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
      }
      throw error;
    }

    if (phoneHash === session.phoneHash) {
      return NextResponse.json({ error: 'That is your own number' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Resolve now if they are on Saku, so the transfer screen does not have to look it up again.
    // Left NULL when they are not — and re-resolved on read is deliberately not done: a contact
    // joining Saku later is picked up the next time they are added or transferred to.
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('phone_hash', phoneHash)
      .maybeSingle();

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

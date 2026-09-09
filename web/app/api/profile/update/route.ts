/**
 * Update the caller's own display name.
 *
 * `display_name` is the only writable field on `users`: `phone_hash` is set once at
 * `/api/verify-otp` and never changes, and there is no `phone_number` column to edit — v2 never
 * stores the plain number (see `lib/phone.ts`). The browser cannot write `users` directly either
 * way, since every table is RLS-on with no permissive policy; this route is the one place that
 * holds the service-role key.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  try {
    const body = await request.json();
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    if (displayName.length < 1 || displayName.length > 64) {
      return NextResponse.json({ error: 'Name must be 1-64 characters' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('users')
      .update({ display_name: displayName })
      .eq('id', session.userId)
      .select('id, display_name')
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, user: data });
  } catch {
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}

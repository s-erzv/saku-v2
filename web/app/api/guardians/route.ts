/**
 * Guardians: list the ones protecting this account, and invite new ones.
 *
 * A guardian is a second human in the recovery path. Fase 6 will not hand an account to a new
 * phone number on the strength of an email link alone, because an email account is itself a
 * common takeover target — one more thing the attacker already has is not a second factor. A
 * person who knows the account owner is different evidence, not more of the same.
 *
 * Two kinds of guardian, one table. Somebody already on Saku is referenced by `guardian_user_id`
 * and answers in-app, authenticated by their own session. Somebody who is not is held by their
 * number — hashed to match them if they ever register, encrypted so a recovery can still reach
 * them — and answers through a link sent to their WhatsApp.
 *
 * The second kind exists because requiring an account made recovery unreachable for the people
 * who need it most: this route used to return `NOT_REGISTERED` for any number without a Saku
 * account, no client handled that code, and the owner dead-ended on a raw error string. An
 * account whose trusted people are all outside the app had no way to become recoverable at all.
 *
 * Neither kind is privileged over the other once invited. Both accept, both wait out the same
 * 24-hour cooling period, and both count as exactly one vote on a panel that still also requires
 * the owner's backup email.
 */

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';
import { InvalidPhoneNumberError, normalizePhone, phoneHashCandidates } from '@/lib/phone';
import { findUserByPhone } from '@/lib/phone-identity';
import {
  guardianCooldownRemainingMs,
  guardianDisplayState,
  guardianEffectiveAt,
  isGuardianEligible,
  MAX_GUARDIANS,
  type GuardianRow,
} from '@/lib/guardians';
import { namesSeenBy, UNKNOWN_PERSON } from '@/lib/guardian-names';
import { isRecoveryExpired, type RecoveryRequestRow } from '@/lib/recovery';
import { sendPushNotification } from '@/lib/push';
import { createGuardianToken, inviteFields } from '@/lib/guardian-invite';
import { sendWhatsApp } from '@/lib/whatsapp';
import { appOrigin } from '@/lib/app-url';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiter';
import { describeDbError } from '@/lib/db-errors';
import { logAuthEvent } from '@/lib/audit-log';

type GuardianRecord = GuardianRow & {
  label: string;
  guardian_user_id: string | null;
  user_id: string;
  invited_at: string;
};

function present(row: GuardianRecord) {
  return {
    id: row.id,
    label: row.label,
    state: guardianDisplayState(row),
    cooldownMs: guardianCooldownRemainingMs(row),
    invitedAt: row.invited_at,
    approvedAt: row.approved_at,
    effectiveAt: row.effective_at,
  };
}

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  try {
    const supabase = getSupabaseAdmin();

    const [mine, addressedToMe] = await Promise.all([
      supabase
        .from('guardians')
        .select('id, user_id, guardian_user_id, label, status, approved_at, effective_at, invited_at')
        .eq('user_id', session.userId)
        .neq('status', 'revoked')
        .order('invited_at', { ascending: true }),
      supabase
        .from('guardians')
        .select('id, user_id, guardian_user_id, label, status, approved_at, effective_at, invited_at')
        .eq('guardian_user_id', session.userId)
        .eq('status', 'invited')
        .order('invited_at', { ascending: true }),
    ]);

    if (mine.error) throw mine.error;
    if (addressedToMe.error) throw addressedToMe.error;

    // Who is asking me to guard them, named the way I know them, with a flag when the name is
    // only what their account calls itself. See `lib/guardian-names.ts`.
    const inviters = await namesSeenBy(
      supabase,
      session.userId,
      (addressedToMe.data ?? []).map((r) => r.user_id)
    );

    // Recovery requests still waiting on this person: ones where they hold a seat on the panel
    // fixed when the owner's email answered, have not voted yet, and are still eligible
    // themselves. A request whose email has not answered has no panel, so it never shows — an
    // unconfirmed request is not yet anybody else's problem, and surfacing it would make this a
    // way to alarm someone's contacts.
    const { data: myGuardianRows } = await supabase
      .from('guardians')
      .select('id, user_id, status, approved_at, effective_at')
      .eq('guardian_user_id', session.userId)
      .neq('status', 'revoked');

    const myEligibleIds = (myGuardianRows ?? [])
      .filter((g) => isGuardianEligible(g as GuardianRow))
      .map((g) => g.id);

    const { data: openSeats } =
      myEligibleIds.length > 0
        ? await supabase
            .from('recovery_request_guardians')
            .select('recovery_request_id')
            .in('guardian_id', myEligibleIds)
            .is('approved_at', null)
        : { data: [] as Array<{ recovery_request_id: string }> };

    const waitingIds = [...new Set((openSeats ?? []).map((s) => s.recovery_request_id))];

    let recoveries: Array<{ id: string; requestedBy: string; inContacts: boolean; requestedAt: string }> = [];

    if (waitingIds.length > 0) {
      const { data: pendingRecoveries } = await supabase
        .from('recovery_requests')
        .select('id, user_id, requested_at, email_verified_at, guardian_approved_at, expires_at, status')
        .in('id', waitingIds)
        .eq('status', 'pending')
        .not('email_verified_at', 'is', null)
        .is('guardian_approved_at', null);

      const live = (pendingRecoveries ?? []).filter(
        (r) => !isRecoveryExpired(r as RecoveryRequestRow)
      );

      if (live.length > 0) {
        const names = await namesSeenBy(supabase, session.userId, live.map((r) => r.user_id));
        recoveries = live.map((r) => {
          const who = names.get(r.user_id) ?? UNKNOWN_PERSON;
          return {
            id: r.id,
            requestedBy: who.name,
            inContacts: who.inContacts,
            requestedAt: r.requested_at,
          };
        });
      }
    }

    return NextResponse.json({
      guardians: (mine.data ?? []).map((r) => present(r as GuardianRecord)),
      invitations: (addressedToMe.data ?? []).map((r) => {
        const who = inviters.get(r.user_id) ?? UNKNOWN_PERSON;
        return {
          id: r.id,
          requestedBy: who.name,
          inContacts: who.inContacts,
          invitedAt: r.invited_at,
        };
      }),
      recoveries,
      limit: MAX_GUARDIANS,
    });
  } catch (error) {
    const { message } = describeDbError(error, 'Could not load your guardians');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Invite someone who is not on Saku, over WhatsApp.
 *
 * The row is written before the message is sent and deleted again if the send fails, for the
 * same reason `request-otp` deletes an unsent challenge: a guardian row nobody was told about
 * occupies one of the owner's three slots and shows up in Settings as a pending invitation that
 * will never be answered.
 *
 * The token lives only in the message. What the database keeps is its hash, so a dump cannot
 * accept an invitation.
 */
async function inviteByWhatsApp(
  request: Request,
  supabase: SupabaseClient,
  params: { ownerId: string; rawPhone: string; dialCode: string; label: string }
): Promise<NextResponse> {
  const { ownerId, rawPhone, dialCode, label } = params;

  const invite = createGuardianToken();

  const { data: created, error } = await supabase
    .from('guardians')
    .insert({
      user_id: ownerId,
      guardian_user_id: null,
      ...inviteFields(rawPhone, dialCode),
      invite_token_hash: invite.hash,
      label,
      status: 'invited',
      // Rewritten from the moment of acceptance. The placeholder keeps the column non-null and
      // errs towards refusing rather than granting if anything ever read it early.
      effective_at: guardianEffectiveAt().toISOString(),
    })
    .select('id, user_id, guardian_user_id, label, status, approved_at, effective_at, invited_at')
    .single();

  if (error) throw error;

  // Named the way the guardian would know them, not by account id. "Someone asked you" is
  // either ignored or, worse, accepted blindly.
  const { data: owner } = await supabase
    .from('users')
    .select('display_name')
    .eq('id', ownerId)
    .maybeSingle();
  const inviterName = owner?.display_name?.trim() || 'Someone you know';

  const link = `${appOrigin(request)}/guardian/invite/${invite.token}`;
  const outcome = await sendWhatsApp(
    normalizePhone(rawPhone, dialCode),
    `*[ SAKU ]*\n\n${inviterName} asked you to be a guardian of their Saku account.\n\n` +
      'That means if they ever lose their phone number, you are one of the people who confirms ' +
      'it is really them. You do not need a Saku account and it costs you nothing.\n\n' +
      `Read what it involves and decide here:\n${link}\n\n` +
      'If you do not know who this is, ignore this message. Nothing happens unless you agree.',
    'guardian-invite'
  );

  if (outcome !== 'sent') {
    await supabase.from('guardians').delete().eq('id', created.id);
    if (outcome === 'not-on-whatsapp') {
      return NextResponse.json(
        { error: 'That number has no WhatsApp account. Check the number and the country code.' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: 'Could not send that invitation. Try again shortly.' },
      { status: 502 }
    );
  }

  await notifyOwnerOfNewGuardian(supabase, ownerId, label);
  await logAuthEvent(request, { type: 'guardian_invited', userId: ownerId });

  return NextResponse.json({ guardian: present(created as GuardianRecord) }, { status: 201 });
}

/**
 * Tell the account owner that a guardian was added to their account.
 *
 * The cooling period on a new guardian buys the owner one night to notice and revoke — revoking
 * has no delay, so the owner can always disarm faster than an attacker can arm. That only works
 * if something wakes them. Until this existed the only notification went to the guardian, so the
 * window protected someone who was never told it had opened.
 */
async function notifyOwnerOfNewGuardian(
  supabase: SupabaseClient,
  ownerId: string,
  label: string
): Promise<void> {
  const notification = {
    userId: ownerId,
    type: 'security_alert' as const,
    message: `${label} was added as a guardian of your account. If this was not you, remove them now.`,
    metadata: { guardian_added: label },
  };

  await supabase.from('notifications').insert({
    user_id: notification.userId,
    type: notification.type,
    message: notification.message,
    metadata: notification.metadata,
  });
  await sendPushNotification(notification);
}

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  // Inviting is a write that sends someone else a notification, so it gets the same treatment as
  // the other lookups: an attacker should not be able to use it to spray invitations.
  if (!(await checkRateLimit(`guardian-invite:${session.userId}`, RATE_LIMITS.RESOLVE)).allowed) {
    return NextResponse.json({ error: 'Too many invitations. Try again shortly.' }, { status: 429 });
  }

  // Two ways in, because the picker and the manual form know different things. Choosing from
  // the contact list can only send an id: `contacts` stores a hash of the number and never the
  // number itself, so the screen showing that list genuinely cannot produce one.
  let contactId: string | null = null;
  let rawPhone = '';
  let dialCode = '62';
  let label = '';
  try {
    const body = await request.json();
    label = typeof body.label === 'string' ? body.label.trim() : '';

    if (typeof body.contactId === 'string' && body.contactId.length > 0) {
      contactId = body.contactId;
    } else {
      dialCode = body.countryCode || '62';
      rawPhone = body.phone;
      if (label.length < 1 || label.length > 64) throw new Error('label');
      phoneHashCandidates(rawPhone, dialCode);
    }
  } catch (error) {
    if (error instanceof InvalidPhoneNumberError) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }
    return NextResponse.json({ error: 'A name and phone number are required' }, { status: 400 });
  }

  // Guarding yourself fails exactly when it is needed: the factor is unreachable for the same
  // reason the account is. Caught here as well as in the database so the message is a sentence
  // rather than a constraint violation.
  if (!contactId && phoneHashCandidates(rawPhone, dialCode).some((c) => c.hash === session.phoneHash)) {
    return NextResponse.json({ error: 'You cannot be your own guardian' }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();

    let guardianUser: { id: string; display_name: string | null } | null = null;

    if (contactId) {
      // Scoped to the caller's own contacts, so an id guessed from somewhere else resolves to
      // nothing rather than to a stranger's row.
      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .select('label, contact_user_id')
        .eq('id', contactId)
        .eq('owner_id', session.userId)
        .maybeSingle();

      if (contactError) throw contactError;
      if (!contact) {
        return NextResponse.json({ error: 'That contact does not exist' }, { status: 404 });
      }
      if (!contact.contact_user_id) {
        // `contacts` stores a hash of the number and never the number, so there is nothing here
        // to send a message to. The owner has to type it, which the client turns this code into
        // a prompt for rather than a dead end.
        return NextResponse.json(
          {
            error: 'That contact is not on Saku yet. Enter their number and we will invite them on WhatsApp.',
            code: 'NEEDS_NUMBER',
          },
          { status: 409 }
        );
      }
      if (contact.contact_user_id === session.userId) {
        return NextResponse.json({ error: 'You cannot be your own guardian' }, { status: 400 });
      }

      guardianUser = { id: contact.contact_user_id, display_name: null };
      if (label.length < 1 || label.length > 64) label = contact.label;
    } else {
      const found = await findUserByPhone<{ id: string; display_name: string | null }>(
        supabase,
        rawPhone,
        dialCode,
        'id, display_name'
      );
      guardianUser = found.user;
    }

    // A number with no Saku account is invited over WhatsApp instead of refused. This used to
    // be a 404 that no client handled, which made an account whose trusted people are all
    // outside the app permanently unrecoverable.
    if (!guardianUser && !contactId) {
      return inviteByWhatsApp(request, supabase, {
        ownerId: session.userId,
        rawPhone,
        dialCode,
        label,
      });
    }

    if (!guardianUser) {
      return NextResponse.json(
        { error: 'That contact is not on Saku yet', code: 'NEEDS_NUMBER' },
        { status: 409 }
      );
    }

    // The cap is also a trigger, which is what actually holds under concurrency. Checking here
    // buys a readable message for the ordinary case.
    const { count } = await supabase
      .from('guardians')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', session.userId)
      .neq('status', 'revoked');

    if ((count ?? 0) >= MAX_GUARDIANS) {
      return NextResponse.json(
        { error: `You can have at most ${MAX_GUARDIANS} guardians` },
        { status: 409 }
      );
    }

    // `effective_at` is written again on approval, from the approval moment. The value here is a
    // placeholder that keeps the column non-null and, if anything ever read it early, errs
    // towards refusing rather than granting.
    const { data: created, error } = await supabase
      .from('guardians')
      .insert({
        user_id: session.userId,
        guardian_user_id: guardianUser.id,
        label,
        status: 'invited',
        effective_at: guardianEffectiveAt().toISOString(),
      })
      .select('id, user_id, guardian_user_id, label, status, approved_at, effective_at, invited_at')
      .single();

    if (error) throw error;

    // Named the way the guardian knows the inviter, so the notification alone says whose account
    // this is. A generic "someone asked you" is either ignored or, worse, accepted blindly.
    const inviter =
      (await namesSeenBy(supabase, guardianUser.id, [session.userId])).get(session.userId) ??
      UNKNOWN_PERSON;

    const notification = {
      userId: guardianUser.id,
      type: 'security_alert' as const,
      message: `${inviter.name} asked you to be their Saku guardian.`,
      metadata: { guardian_invite_id: created.id },
    };

    await supabase.from('notifications').insert({
      user_id: notification.userId,
      type: notification.type,
      message: notification.message,
      metadata: notification.metadata,
    });
    await sendPushNotification(notification);
    await notifyOwnerOfNewGuardian(supabase, session.userId, label);
    await logAuthEvent(request, { type: 'guardian_invited', userId: session.userId });

    return NextResponse.json({ guardian: present(created as GuardianRecord) }, { status: 201 });
  } catch (error) {
    // The partial unique index and the limit trigger both surface here. Neither is a server
    // fault, so neither should read as one.
    const { message, code } = describeDbError(error, 'Could not send that invitation');
    if (code === '23505') {
      return NextResponse.json({ error: 'They are already one of your guardians' }, { status: 409 });
    }
    if (code === '23514') {
      return NextResponse.json({ error: `You can have at most ${MAX_GUARDIANS} guardians` }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

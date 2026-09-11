/**
 * The link from the first recovery email.
 *
 * Opening it proves control of the backup address and nothing more. A majority of guardians still
 * has to agree, and the new number is chosen later still, from a second link that is only sent
 * once they have — which is why an intercepted link is not by itself a takeover.
 *
 * The first time it is opened it also fixes the guardian panel: which guardians get a vote, and how
 * many must agree. See the migration `20260911_recovery_guardian_majority.sql` for why that is a
 * snapshot rather than a live count.
 *
 * It is meant to be opened more than once. Each visit lands on the screen for wherever the
 * request now stands, which is how someone who closed the tab picks back up. Starting over instead
 * would throw away the confirmation they already gave.
 */

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { hashToken, tokenMatches } from '@/lib/email';
import { isGuardianEligible, isGuardianReachable, type GuardianRow } from '@/lib/guardians';
import { namesSeenBy, UNKNOWN_PERSON } from '@/lib/guardian-names';
import { recoveryStage, requiredGuardianApprovals, type RecoveryRequestRow } from '@/lib/recovery';
import { sendPushNotification } from '@/lib/push';
import { appOrigin } from '@/lib/app-url';
import { createGuardianToken, decryptPhone } from '@/lib/guardian-invite';
import { sendWhatsApp } from '@/lib/whatsapp';

function recoverUrl(request: Request, stage: string, extra: Record<string, number> = {}): string {
  const query = new URLSearchParams({ stage });
  for (const [key, value] of Object.entries(extra)) query.set(key, String(value));
  return `${appOrigin(request)}/recover?${query.toString()}`;
}

/** A guardian on a fixed panel, and how they can be reached. */
interface PanelMember {
  id: string;
  guardian_user_id: string | null;
  invite_phone_ciphertext: string | null;
}

/**
 * Send each off-app guardian the link that is their only way to answer.
 *
 * The token is written to their seat on the panel, not to the guardian row, which is what binds
 * it to this one recovery: a link issued for one request cannot vote on another, and once the
 * seat carries an `approved_at` the same link cannot vote twice. Only the hash is stored, so the
 * token exists in one WhatsApp message and nowhere else.
 *
 * Best effort, one guardian at a time. A gateway failure must not roll back a confirmation the
 * owner has already made — the recovery stays open for seven days and the owner can see, on the
 * progress screen, who has not answered.
 */
async function askGuardiansOnWhatsApp(
  request: Request,
  supabase: SupabaseClient,
  recoveryId: string,
  ownerId: string,
  members: PanelMember[]
): Promise<void> {
  if (members.length === 0) return;

  const { data: owner } = await supabase
    .from('users')
    .select('display_name')
    .eq('id', ownerId)
    .maybeSingle();
  const ownerName = owner?.display_name?.trim() || 'Someone you agreed to help';

  const { data: expiry } = await supabase
    .from('recovery_requests')
    .select('expires_at')
    .eq('id', recoveryId)
    .maybeSingle();

  for (const member of members) {
    try {
      const vote = createGuardianToken();

      const { error } = await supabase
        .from('recovery_request_guardians')
        .update({
          approve_token_hash: vote.hash,
          // Dies with the request it belongs to. A vote that outlived its recovery would be a
          // standing approval waiting for the next one.
          token_expires_at: expiry?.expires_at ?? null,
        })
        .eq('recovery_request_id', recoveryId)
        .eq('guardian_id', member.id)
        .is('approved_at', null);

      if (error) throw error;

      const link = `${appOrigin(request)}/guardian/approve/${vote.token}`;
      await sendWhatsApp(
        decryptPhone(member.invite_phone_ciphertext as string),
        `*[ SAKU ]*\n\n${ownerName} says they lost their phone number and is trying to move ` +
          'their Saku account to a new one. You agreed to be one of the people who confirms ' +
          'this.\n\n' +
          '*Call or speak to them first.* Only confirm if you are sure it is really them — this ' +
          'moves their account and the money in it.\n\n' +
          `Answer here:\n${link}`,
        'guardian-approve'
      );
    } catch (error) {
      console.error('[recovery] could not reach guardian', member.id, error);
    }
  }
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return NextResponse.redirect(recoverUrl(request, 'invalid'));

  try {
    const supabase = getSupabaseAdmin();

    // Not filtered to pending: an old email opened after the recovery finished or closed should
    // say so, not claim the link is invalid.
    const { data: recovery } = await supabase
      .from('recovery_requests')
      .select(
        'id, user_id, status, email_token_hash, email_verified_at, guardian_approved_at, expires_at, required_approvals'
      )
      .eq('email_token_hash', hashToken(token))
      .maybeSingle();

    if (!recovery?.email_token_hash || !tokenMatches(token, recovery.email_token_hash)) {
      return NextResponse.redirect(recoverUrl(request, 'invalid'));
    }

    const stage = recoveryStage(recovery as RecoveryRequestRow);

    // The guardians have already approved. The next step lives behind the second email.
    if (stage === 'choose_number') {
      return NextResponse.redirect(recoverUrl(request, 'guardian_approved'));
    }
    if (stage === 'done' || stage === 'rejected' || stage === 'expired') {
      return NextResponse.redirect(recoverUrl(request, stage));
    }

    let firstConfirmation = false;
    let notify: PanelMember[] = [];

    if (!recovery.email_verified_at) {
      const { data: guardianRows, error: guardianError } = await supabase
        .from('guardians')
        .select('id, guardian_user_id, invite_phone_ciphertext, status, approved_at, effective_at')
        .eq('user_id', recovery.user_id)
        .neq('status', 'revoked');

      if (guardianError) throw guardianError;

      // Reachable *and* eligible. A guardian who is allowed to vouch but cannot be contacted
      // still counts towards the majority, so including one raises the bar the owner has to
      // clear while contributing nothing towards clearing it.
      const eligible = (guardianRows ?? []).filter(
        (g) => isGuardianReachable(g) && isGuardianEligible(g as GuardianRow)
      );

      // The panel is fixed here, once. Everything after reads this snapshot, so removing
      // guardians mid-request cannot lower the bar and adding some cannot pad it. Written before
      // the email is marked confirmed, and idempotently, so a failure part-way leaves a request
      // this same link can finish setting up.
      if (eligible.length > 0) {
        const { error: panelError } = await supabase.from('recovery_request_guardians').upsert(
          eligible.map((g) => ({ recovery_request_id: recovery.id, guardian_id: g.id })),
          { onConflict: 'recovery_request_id,guardian_id', ignoreDuplicates: true }
        );
        if (panelError) throw panelError;

        const { error: requiredError } = await supabase
          .from('recovery_requests')
          .update({ required_approvals: requiredGuardianApprovals(eligible.length) })
          .eq('id', recovery.id)
          .is('required_approvals', null);
        if (requiredError) throw requiredError;
      }

      const now = new Date().toISOString();
      const { data: confirmed } = await supabase
        .from('recovery_requests')
        .update({ email_verified_at: now, updated_at: now })
        .eq('id', recovery.id)
        .is('email_verified_at', null)
        .select('id')
        .maybeSingle();

      firstConfirmation = !!confirmed;
      notify = eligible as PanelMember[];
    }

    // Guardians hear about it only once the address has answered — earlier, anyone who knows a
    // phone number could alarm that person's contacts — and only on the first confirmation. The
    // link is meant to be reopened, and a guardian pinged every time the owner checks progress
    // would learn to ignore it.
    if (firstConfirmation && notify.length > 0) {
      // A guardian on Saku is told in-app, where the warning and the "not in your contacts" flag
      // live. One who is not has no session and no screen to be told on, so the ask goes to the
      // number they were invited on, carrying a token that is their only way to answer.
      const inApp = notify.filter((g) => g.guardian_user_id);
      const byWhatsApp = notify.filter((g) => !g.guardian_user_id && g.invite_phone_ciphertext);

      await askGuardiansOnWhatsApp(request, supabase, recovery.id, recovery.user_id, byWhatsApp);

      // Each guardian sees the owner under their own name for them. See `lib/guardian-names.ts`.
      const notifications = await Promise.all(
        inApp.map(async (g) => {
          const viewer = g.guardian_user_id as string;
          const owner =
            (await namesSeenBy(supabase, viewer, [recovery.user_id])).get(recovery.user_id) ??
            UNKNOWN_PERSON;
          return {
            user_id: viewer,
            type: 'security_alert' as const,
            message: `${owner.name} is trying to recover their Saku account. Only approve if you have spoken to them.`,
            metadata: { recovery_request_id: recovery.id },
          };
        })
      );

      if (notifications.length > 0) await supabase.from('notifications').insert(notifications);
      for (const n of notifications) {
        await sendPushNotification({
          userId: n.user_id,
          type: n.type,
          message: n.message,
          metadata: n.metadata,
        });
      }
    }

    const { data: seats, error: seatsError } = await supabase
      .from('recovery_request_guardians')
      .select('approved_at')
      .eq('recovery_request_id', recovery.id);

    if (seatsError) throw seatsError;

    const panel = seats?.length ?? 0;

    // A request with nobody on its panel cannot finish, and saying so here is kinder than a wait
    // that never ends. The screen explains the rest.
    if (panel === 0) return NextResponse.redirect(recoverUrl(request, 'no_guardian'));

    return NextResponse.redirect(
      recoverUrl(request, 'awaiting_guardian', {
        panel,
        required: recovery.required_approvals ?? requiredGuardianApprovals(panel),
        approved: (seats ?? []).filter((s) => s.approved_at).length,
      })
    );
  } catch {
    return NextResponse.redirect(recoverUrl(request, 'failed'));
  }
}

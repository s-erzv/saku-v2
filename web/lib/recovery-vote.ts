/**
 * Casting one guardian's vote on a recovery, wherever it came from.
 *
 * Two routes reach this: `/api/recovery/[id]/approve`, where a guardian with a Saku account is
 * authorised by their session, and `/api/recovery/approve/[token]`, where a guardian without one
 * is authorised by the link that was sent to their WhatsApp. How they proved who they are
 * differs; what happens to the request afterwards must not.
 *
 * That is the whole reason this is a module. Counting the majority, minting the owner's finish
 * link and undoing the majority when that link cannot be sent are three rules with sharp edges,
 * and a second copy of them drifts: one side gets a fix, the other keeps the hole, and the
 * weaker of the two is the one an attacker uses. The same argument `lib/otp-challenge.ts` makes.
 *
 * Authorisation is the caller's job. By the time anything here runs, the caller has already
 * established that this guardian holds this seat.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { createEmailToken, decryptEmail } from '@/lib/email';
import { sendEmail } from '@/lib/mailer';
import { recoveryFinishExpiresAt } from '@/lib/recovery';

export type VoteOutcome =
  | { kind: 'rejected' }
  | { kind: 'counted'; approvals: number; required: number }
  | { kind: 'completed'; approvals: number; required: number }
  | { kind: 'no_backup_email' };

interface VoteParams {
  recoveryId: string;
  guardianId: string;
  /** The account being recovered, for the finish link's destination. */
  ownerId: string;
  /** What the request's clock was before a majority replaced it, for the undo below. */
  previousExpiresAt: string;
  requiredApprovals: number;
  accept: boolean;
  appOrigin: string;
}

export async function castGuardianVote(
  supabase: SupabaseClient,
  params: VoteParams
): Promise<VoteOutcome> {
  const { recoveryId, guardianId, ownerId, previousExpiresAt, requiredApprovals, accept } = params;

  const now = new Date();
  const nowIso = now.toISOString();

  // One "no" closes the whole request. There is no row for a rejection: a guardian who does not
  // believe it is really them is not a vote to be outnumbered.
  if (!accept) {
    await supabase
      .from('recovery_requests')
      .update({ status: 'rejected', resolved_at: nowIso, updated_at: nowIso })
      .eq('id', recoveryId)
      .eq('status', 'pending');
    return { kind: 'rejected' };
  }

  const { error: voteError } = await supabase
    .from('recovery_request_guardians')
    .update({ approved_at: nowIso })
    .eq('recovery_request_id', recoveryId)
    .eq('guardian_id', guardianId)
    .is('approved_at', null);
  if (voteError) throw voteError;

  const { count, error: countError } = await supabase
    .from('recovery_request_guardians')
    .select('guardian_id', { count: 'exact', head: true })
    .eq('recovery_request_id', recoveryId)
    .not('approved_at', 'is', null);
  if (countError) throw countError;

  const approvals = count ?? 0;
  if (approvals < requiredApprovals) {
    return { kind: 'counted', approvals, required: requiredApprovals };
  }

  const { data: owner, error: ownerError } = await supabase
    .from('users')
    .select('email_ciphertext, email_verified_at')
    .eq('id', ownerId)
    .maybeSingle();
  if (ownerError) throw ownerError;

  if (!owner?.email_ciphertext || !owner.email_verified_at) {
    // The address was removed after the request started, so there is nowhere to send the last
    // link. Closing the request now is more honest than an approval that leads nowhere.
    await supabase
      .from('recovery_requests')
      .update({ status: 'expired', resolved_at: nowIso, updated_at: nowIso })
      .eq('id', recoveryId)
      .eq('status', 'pending');
    return { kind: 'no_backup_email' };
  }

  const finish = createEmailToken();

  const { data: reached, error: reachError } = await supabase
    .from('recovery_requests')
    .update({
      guardian_approved_at: nowIso,
      approved_by_guardian_id: guardianId,
      finish_token_hash: finish.hash,
      // The rest of the week is replaced, not extended — see RECOVERY_FINISH_WINDOW_MS.
      expires_at: recoveryFinishExpiresAt(now.getTime()).toISOString(),
      updated_at: nowIso,
    })
    .eq('id', recoveryId)
    .eq('status', 'pending')
    // Conditional on the majority not already being recorded, so two deciding votes landing at
    // once cannot mint two finish links.
    .is('guardian_approved_at', null)
    .select('id')
    .maybeSingle();

  if (reachError) throw reachError;
  // Another guardian's vote reached the majority a moment earlier; their request sent the email.
  if (!reached) return { kind: 'completed', approvals, required: requiredApprovals };

  const link = `${params.appOrigin}/api/recovery/continue?token=${finish.token}`;

  try {
    await sendEmail({
      to: decryptEmail(owner.email_ciphertext),
      subject: 'Your guardians confirmed it is you — choose your new Saku number',
      text:
        'Enough of your guardians confirmed your request to recover your Saku account.\n\n' +
        `Open this link to choose the new phone number for your account:\n${link}\n\n` +
        'It works for 24 hours. After that you will have to start the recovery again.\n\n' +
        'If you did not ask to recover your account, do not open the link, and talk to your ' +
        'guardians.',
    });
  } catch (sendError) {
    // Without this email the owner has no way to reach the last step, so reaching the majority
    // is undone rather than left to expire in silence. The votes stay; any guardian tapping
    // approve again re-runs this.
    await supabase
      .from('recovery_requests')
      .update({
        guardian_approved_at: null,
        approved_by_guardian_id: null,
        finish_token_hash: null,
        expires_at: previousExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', recoveryId);
    throw sendError;
  }

  return { kind: 'completed', approvals, required: requiredApprovals };
}

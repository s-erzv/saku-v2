/**
 * Resolving a phone number to an account while two hashing rules are in play.
 *
 * `lib/phone.ts` now hashes with a pepper (version 2), but rows written before that still hold
 * the unkeyed keccak256 (version 1), and nothing can rewrite them in advance: the plaintext
 * number is not stored anywhere, by design. So every lookup that starts from a number has to be
 * prepared to find either, and every successful OTP — the one moment the number exists in
 * memory — is an opportunity to move one account forward permanently.
 *
 * Writers do not use this module. They call `hashPhone` and get version 2, because a value
 * being written now has no history to be compatible with.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { CURRENT_PHONE_HASH_VERSION, phoneHashCandidates } from '@/lib/phone';

export interface PhoneLookup<T> {
  /** The matching row, or null when this number belongs to nobody. */
  user: T | null;
  /** Which hashing rule found it. Null when nothing matched. */
  matchedVersion: number | null;
  /** Version 2 hash of this number — what a row for it should eventually hold. */
  currentHash: string;
  /** Version 1 hash, needed to find and rewrite anything still filed under it. */
  legacyHash: string;
}

/**
 * Find the account for a phone number, newest hashing rule first.
 *
 * Order matters for more than speed. Once an account has migrated, its version 1 hash matches
 * nothing, so trying version 2 first means the common case costs one query and the fallback
 * disappears on its own as users sign in.
 */
export async function findUserByPhone<T = { id: string }>(
  supabase: SupabaseClient,
  raw: string,
  country: string,
  columns = 'id'
): Promise<PhoneLookup<T>> {
  const [current, legacy] = phoneHashCandidates(raw, country);

  for (const candidate of [current, legacy]) {
    const { data, error } = await supabase
      .from('users')
      .select(columns)
      .eq('phone_hash', candidate.hash)
      .maybeSingle();

    if (error) throw error;
    if (data) {
      return {
        user: data as T,
        matchedVersion: candidate.version,
        currentHash: current.hash,
        legacyHash: legacy.hash,
      };
    }
  }

  return { user: null, matchedVersion: null, currentHash: current.hash, legacyHash: legacy.hash };
}

/**
 * Move one account, and everything that references it, onto the peppered hash.
 *
 * The work happens inside `migrate_phone_hash` rather than here because five tables have to
 * move together — see the comment on that function. This wrapper only decides whether to call
 * it and refuses to let a failure take down the sign-in that triggered it.
 *
 * A failed migration is genuinely survivable: the account stays on version 1, every lookup
 * still finds it through the fallback above, and the next sign-in tries again. Refusing the
 * login instead would mean a user locked out of their own money by a housekeeping task.
 */
export async function upgradePhoneHashIfNeeded(
  supabase: SupabaseClient,
  params: { userId: string; matchedVersion: number | null; legacyHash: string; currentHash: string }
): Promise<{ upgraded: boolean; rowsMoved: number }> {
  if (params.matchedVersion === null || params.matchedVersion >= CURRENT_PHONE_HASH_VERSION) {
    return { upgraded: false, rowsMoved: 0 };
  }

  try {
    const { data, error } = await supabase.rpc('migrate_phone_hash', {
      p_user_id: params.userId,
      p_old_hash: params.legacyHash,
      p_new_hash: params.currentHash,
    });

    if (error) throw error;
    return { upgraded: true, rowsMoved: typeof data === 'number' ? data : 0 };
  } catch (error) {
    console.error('[phone-identity] hash upgrade failed, leaving the account on version 1', error);
    return { upgraded: false, rowsMoved: 0 };
  }
}

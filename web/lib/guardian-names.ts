/**
 * Who a guardian is dealing with, named the way *they* would name them.
 *
 * Every message that asks a guardian to act — accept an invitation, approve a recovery — has to
 * say whose account it is, or the guardian is being asked to vouch for a blank. But the obvious
 * name, `users.display_name`, is chosen by the account holder, and an attacker's account can call
 * itself "Mama" as easily as anyone's. So the name shown is the guardian's own label for that
 * person when they have them saved in their contacts, which the other side cannot influence, and
 * the self-chosen display name only as a fallback, flagged as such so the screen can say so.
 *
 * Never the phone number, although it would be the most recognisable: `contacts` holds only a
 * hash, and a number on this screen would disclose more than the request needs.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface SeenName {
  name: string;
  /** True when `name` is the viewer's own contact label rather than something the account chose. */
  inContacts: boolean;
}

export const UNKNOWN_PERSON: SeenName = { name: 'A Saku user', inContacts: false };

/**
 * Names for `userIds`, as `viewerId` would recognise them. Every requested id gets an entry.
 *
 * Never throws. A name is decoration on a notification or a list row, and a lookup failure must
 * not cost a guardian the notification itself — they fall back to the generic name instead.
 */
export async function namesSeenBy(
  supabase: SupabaseClient,
  viewerId: string,
  userIds: string[]
): Promise<Map<string, SeenName>> {
  const ids = [...new Set(userIds)];
  const result = new Map<string, SeenName>(ids.map((id) => [id, UNKNOWN_PERSON]));
  if (ids.length === 0) return result;

  try {
    const { data: people, error: peopleError } = await supabase
      .from('users')
      .select('id, display_name, phone_hash')
      .in('id', ids);

    if (peopleError) throw peopleError;

    const idByHash = new Map<string, string>((people ?? []).map((p) => [p.phone_hash, p.id]));

    // By user id for contacts saved after the person joined Saku, and by phone hash for ones saved
    // before, whose `contact_user_id` was left null and is never filled in afterwards.
    const filters = [`contact_user_id.in.(${ids.join(',')})`];
    if (idByHash.size > 0) filters.push(`contact_phone_hash.in.(${[...idByHash.keys()].join(',')})`);

    const { data: saved, error: savedError } = await supabase
      .from('contacts')
      .select('label, contact_user_id, contact_phone_hash')
      .eq('owner_id', viewerId)
      .or(filters.join(','));

    if (savedError) throw savedError;

    const labelByUser = new Map<string, string>();
    for (const row of saved ?? []) {
      const userId = ids.includes(row.contact_user_id)
        ? row.contact_user_id
        : idByHash.get(row.contact_phone_hash);
      if (userId && !labelByUser.has(userId)) labelByUser.set(userId, row.label);
    }

    for (const person of people ?? []) {
      const label = labelByUser.get(person.id);
      result.set(
        person.id,
        label
          ? { name: label, inContacts: true }
          : { name: person.display_name || UNKNOWN_PERSON.name, inContacts: false }
      );
    }
  } catch (error) {
    console.error('[guardian-names] lookup failed, using generic names', error);
  }

  return result;
}

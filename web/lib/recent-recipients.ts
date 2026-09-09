/**
 * "You've sent here before" — quick-pick chips built from the device's own send history, not a
 * server-side table. A destination only needs remembering long enough to make the next transfer
 * one tap instead of a re-typed number, so this lives in `localStorage` next to
 * `hooks/useContacts.ts`'s cached numbers rather than adding a table for it.
 *
 * Keyed by `scope` (the caller's own `phone_hash`) — a bare device-wide key would mean a second
 * Saku account logging in on the same browser sees the first account's send history, which is
 * exactly the cross-account leak this device-local cache exists to avoid in the first place.
 * `scope` missing or falsy means no confirmed identity yet, so reads come back empty and writes
 * are dropped rather than falling back to a shared key.
 */

const MAX_RECENTS = 8;

export interface RecentPhone {
  countryCode: string;
  phone: string;
}

export interface RecentBank {
  bankCode: string;
  bankName: string;
  accountNumber: string;
}

function readList<T>(key: string, scope: string | null | undefined): T[] {
  if (!scope) return [];
  try {
    const raw = localStorage.getItem(`${key}:${scope}`);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, scope: string | null | undefined, list: T[]) {
  if (!scope) return;
  try {
    localStorage.setItem(`${key}:${scope}`, JSON.stringify(list.slice(0, MAX_RECENTS)));
  } catch {
    // Non-fatal: the transfer already went through, this is only a convenience for next time.
  }
}

const PHONE_KEY = 'saku_recent_phones';

export function getRecentPhones(scope: string | null | undefined): RecentPhone[] {
  return readList<RecentPhone>(PHONE_KEY, scope);
}

export function rememberRecentPhone(scope: string | null | undefined, entry: RecentPhone) {
  const existing = getRecentPhones(scope).filter(
    (r) => !(r.countryCode === entry.countryCode && r.phone === entry.phone)
  );
  writeList(PHONE_KEY, scope, [entry, ...existing]);
}

const BANK_KEY = 'saku_recent_banks';

export function getRecentBanks(scope: string | null | undefined): RecentBank[] {
  return readList<RecentBank>(BANK_KEY, scope);
}

export function rememberRecentBank(scope: string | null | undefined, entry: RecentBank) {
  const existing = getRecentBanks(scope).filter(
    (r) => !(r.bankCode === entry.bankCode && r.accountNumber === entry.accountNumber)
  );
  writeList(BANK_KEY, scope, [entry, ...existing]);
}

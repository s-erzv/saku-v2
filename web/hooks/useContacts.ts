'use client';

/**
 * Address book.
 *
 * The server only ever holds a label plus a phone hash, so the numbers themselves live here, in
 * this device's `localStorage`, keyed by hash. That is the cost of the schema's decision not to
 * store phone numbers: this device can show them, another device cannot. Losing them loses
 * nothing that matters — a transfer only ever needs the hash.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './useAuth';

export interface Contact {
  id: string;
  label: string;
  phoneHash: string;
  onSaku: boolean;
  /** From this device's local cache, if it added the contact. */
  phone?: string;
}

const LOCAL_NUMBERS_KEY = 'saku_contact_numbers';

/**
 * Namespaced by the caller's own `phone_hash` — a bare key would let a second Saku account
 * logging in on the same browser read the first account's saved numbers straight out of
 * `localStorage`, since nothing else about this cache is per-user.
 */
function readLocalNumbers(scope: string | null | undefined): Record<string, string> {
  if (!scope) return {};
  try {
    return JSON.parse(localStorage.getItem(`${LOCAL_NUMBERS_KEY}:${scope}`) ?? '{}');
  } catch {
    // A corrupt or unavailable store just means numbers are not shown.
    return {};
  }
}

function rememberNumber(scope: string | null | undefined, phoneHash: string, phone: string) {
  if (!scope) return;
  try {
    const all = readLocalNumbers(scope);
    all[phoneHash] = phone;
    localStorage.setItem(`${LOCAL_NUMBERS_KEY}:${scope}`, JSON.stringify(all));
  } catch {
    // Non-fatal: the contact still saves server-side.
  }
}

export function useContacts() {
  const { token, user } = useAuth();
  const scope = user?.phone_hash;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;

    setIsLoading(true);
    try {
      const res = await fetch('/api/contacts', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load contacts');

      const numbers = readLocalNumbers(scope);
      setContacts(
        (data.contacts as Contact[]).map((c) => ({ ...c, phone: numbers[c.phoneHash] }))
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load contacts');
    } finally {
      setIsLoading(false);
    }
  }, [token, scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addContact = useCallback(
    async (label: string, phone: string, countryCode: string) => {
      if (!token) return null;
      setError(null);

      try {
        const res = await fetch('/api/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ label, phone, countryCode }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not save contact');

        // The server gave us the hash it derived; pair it with the number locally.
        rememberNumber(scope, data.contact.phoneHash, `${countryCode}${phone}`);
        await refresh();
        return data.contact as Contact;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save contact');
        return null;
      }
    },
    [token, scope, refresh]
  );

  const removeContact = useCallback(
    async (id: string) => {
      if (!token) return;
      try {
        await fetch(`/api/contacts?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        await refresh();
      } catch {
        setError('Could not delete contact');
      }
    },
    [token, refresh]
  );

  return { contacts, isLoading, error, refresh, addContact, removeContact };
}

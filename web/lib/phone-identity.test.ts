import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';

process.env.PHONE_HMAC_PEPPER ||= 'test-pepper-value-that-is-long-enough-32';

import { hashPhone, hashPhoneLegacy } from '@/lib/phone';
import { findUserByPhone, upgradePhoneHashIfNeeded } from '@/lib/phone-identity';

const PHONE = '081234567890';
const DIAL = '62';

/**
 * A Supabase stand-in that answers only for the hashes it was given, and records what it was
 * asked. Enough to pin the two behaviours that matter here: which hash is tried first, and
 * whether the migration is called at all.
 */
function fakeSupabase(rows: Record<string, unknown>) {
  const queried: string[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  const client = {
    from() {
      return {
        select() {
          return {
            eq(_column: string, value: string) {
              queried.push(value);
              return {
                async maybeSingle() {
                  return { data: rows[value] ?? null, error: null };
                },
              };
            },
          };
        },
      };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return { data: 4, error: null };
    },
  };

  return { client: client as unknown as SupabaseClient, queried, rpcCalls };
}

describe('findUserByPhone', () => {
  it('finds a migrated account on the first query and never asks for the legacy hash', async () => {
    const current = hashPhone(PHONE, DIAL);
    const { client, queried } = fakeSupabase({ [current]: { id: 'user-1' } });

    const lookup = await findUserByPhone(client, PHONE, DIAL);

    assert.equal(lookup.matchedVersion, 2);
    assert.deepEqual(lookup.user, { id: 'user-1' });
    assert.deepEqual(queried, [current]);
  });

  it('falls back to the unkeyed hash for an account that has not signed in yet', async () => {
    const legacy = hashPhoneLegacy(PHONE, DIAL);
    const { client, queried } = fakeSupabase({ [legacy]: { id: 'user-2' } });

    const lookup = await findUserByPhone(client, PHONE, DIAL);

    assert.equal(lookup.matchedVersion, 1);
    assert.deepEqual(lookup.user, { id: 'user-2' });
    assert.equal(queried.length, 2);
    assert.equal(queried[1], legacy);
  });

  it('reports a number belonging to nobody without inventing a version', async () => {
    const { client } = fakeSupabase({});
    const lookup = await findUserByPhone(client, PHONE, DIAL);

    assert.equal(lookup.user, null);
    assert.equal(lookup.matchedVersion, null);
    assert.equal(lookup.currentHash, hashPhone(PHONE, DIAL));
    assert.equal(lookup.legacyHash, hashPhoneLegacy(PHONE, DIAL));
  });
});

describe('upgradePhoneHashIfNeeded', () => {
  const params = {
    userId: 'user-1',
    legacyHash: hashPhoneLegacy(PHONE, DIAL),
    currentHash: hashPhone(PHONE, DIAL),
  };

  it('moves an account found on the legacy hash', async () => {
    const { client, rpcCalls } = fakeSupabase({});
    const result = await upgradePhoneHashIfNeeded(client, { ...params, matchedVersion: 1 });

    assert.equal(result.upgraded, true);
    assert.equal(result.rowsMoved, 4);
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].name, 'migrate_phone_hash');
    assert.deepEqual(rpcCalls[0].args, {
      p_user_id: 'user-1',
      p_old_hash: params.legacyHash,
      p_new_hash: params.currentHash,
    });
  });

  it('does nothing for an account already on the current rule', async () => {
    const { client, rpcCalls } = fakeSupabase({});
    const result = await upgradePhoneHashIfNeeded(client, { ...params, matchedVersion: 2 });

    assert.equal(result.upgraded, false);
    assert.equal(rpcCalls.length, 0);
  });

  it('does nothing when there was no account to match', async () => {
    const { client, rpcCalls } = fakeSupabase({});
    const result = await upgradePhoneHashIfNeeded(client, { ...params, matchedVersion: null });

    assert.equal(result.upgraded, false);
    assert.equal(rpcCalls.length, 0);
  });

  it('lets the sign-in continue when the migration itself fails', async () => {
    const client = {
      async rpc() {
        return { data: null, error: new Error('deadlock detected') };
      },
    } as unknown as SupabaseClient;

    const result = await upgradePhoneHashIfNeeded(client, { ...params, matchedVersion: 1 });
    assert.deepEqual(result, { upgraded: false, rowsMoved: 0 });
  });
});

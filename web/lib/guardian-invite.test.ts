import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.EMAIL_HMAC_PEPPER ||= 'test-email-pepper-long-enough-to-pass-32';
process.env.EMAIL_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64');
process.env.PHONE_HMAC_PEPPER ||= 'test-phone-pepper-long-enough-to-pass-32';

import {
  createGuardianToken,
  decryptPhone,
  encryptPhone,
  guardianInviteExpiresAt,
  guardianTokenMatches,
  hashGuardianToken,
  inviteFields,
  isGuardianInviteExpired,
  GUARDIAN_INVITE_TTL_MS,
} from '@/lib/guardian-invite';

describe('guardian invite tokens', () => {
  it('matches the token it was made from', () => {
    const { token, hash } = createGuardianToken();
    assert.equal(guardianTokenMatches(token, hash), true);
  });

  it('rejects a different token', () => {
    const { hash } = createGuardianToken();
    const other = createGuardianToken();
    assert.equal(guardianTokenMatches(other.token, hash), false);
  });

  it('stores a hash, never the token', () => {
    const { token, hash } = createGuardianToken();
    assert.notEqual(hash, token);
    assert.equal(hash, hashGuardianToken(token));
  });

  it('does not throw on a malformed stored hash', () => {
    const { token } = createGuardianToken();
    assert.equal(guardianTokenMatches(token, 'not-hex'), false);
    assert.equal(guardianTokenMatches(token, ''), false);
  });

  it('issues a fresh token every time', () => {
    const seen = new Set(Array.from({ length: 50 }, () => createGuardianToken().token));
    assert.equal(seen.size, 50);
  });
});

describe('guardian phone storage', () => {
  const NUMBER = '081234567890';

  it('decrypts back to the normalized number, ready for the gateway', () => {
    assert.equal(decryptPhone(encryptPhone(NUMBER, '62')), '6281234567890');
  });

  it('produces a different ciphertext each time, so equal numbers do not look equal', () => {
    assert.notEqual(encryptPhone(NUMBER, '62'), encryptPhone(NUMBER, '62'));
  });

  it('refuses a tampered ciphertext rather than returning a different number', () => {
    const stored = encryptPhone(NUMBER, '62');
    const [iv, tag, data] = stored.split('.');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 0xff;
    assert.throws(() => decryptPhone([iv, tag, flipped.toString('base64url')].join('.')));
  });

  it('refuses a malformed ciphertext', () => {
    assert.throws(() => decryptPhone('nonsense'));
  });

  it('pairs a hash with a ciphertext, as the row constraint requires', () => {
    const fields = inviteFields(NUMBER, '62');
    assert.match(fields.invite_phone_hash, /^0x[0-9a-f]{64}$/);
    assert.equal(decryptPhone(fields.invite_phone_ciphertext), '6281234567890');
  });

  it('hashes the same number to the same value, so a later signup is matched', () => {
    assert.equal(
      inviteFields('081234567890', '62').invite_phone_hash,
      inviteFields('+62 812-3456-7890', '62').invite_phone_hash
    );
  });
});

describe('guardian invite expiry', () => {
  it('lasts a fortnight, because an invited guardian may want to phone the sender first', () => {
    assert.equal(GUARDIAN_INVITE_TTL_MS, 14 * 24 * 60 * 60 * 1000);
  });

  it('is still open one minute before the window closes', () => {
    const invitedAt = Date.UTC(2026, 0, 1, 12, 0, 0);
    const at = new Date(invitedAt);
    assert.equal(isGuardianInviteExpired(at, invitedAt + GUARDIAN_INVITE_TTL_MS - 60_000), false);
  });

  it('is dead once exactly the window has passed', () => {
    const invitedAt = Date.UTC(2026, 0, 1, 12, 0, 0);
    const at = new Date(invitedAt);
    assert.equal(isGuardianInviteExpired(at, invitedAt + GUARDIAN_INVITE_TTL_MS), true);
  });

  it('reads an ISO string the way the row stores it', () => {
    const invitedAt = Date.UTC(2026, 0, 1, 12, 0, 0);
    const iso = new Date(invitedAt).toISOString();
    assert.equal(isGuardianInviteExpired(iso, invitedAt + 1000), false);
    assert.equal(isGuardianInviteExpired(iso, invitedAt + GUARDIAN_INVITE_TTL_MS + 1), true);
  });

  it('expires at the moment the TTL says', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    assert.equal(guardianInviteExpiresAt(now).getTime(), now + GUARDIAN_INVITE_TTL_MS);
  });
});

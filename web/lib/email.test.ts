import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { randomBytes } from 'node:crypto';

process.env.EMAIL_HMAC_PEPPER ||= 'test-email-pepper-long-enough-32chars';
process.env.EMAIL_ENCRYPTION_KEY ||= randomBytes(32).toString('base64url');

import {
  createEmailToken,
  decryptEmail,
  EMAIL_TOKEN_TTL_MS,
  emailTokenExpiresAt,
  encryptEmail,
  hashEmail,
  InvalidEmailError,
  maskEmail,
  normalizeEmail,
  tokenMatches,
} from '@/lib/email';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    assert.equal(normalizeEmail('  Nupers.SV@Gmail.com '), 'nupers.sv@gmail.com');
  });

  it('leaves dots and plus tags alone, because only some providers ignore them', () => {
    assert.notEqual(normalizeEmail('a.b@example.com'), normalizeEmail('ab@example.com'));
    assert.notEqual(normalizeEmail('a+x@example.com'), normalizeEmail('a@example.com'));
  });

  it('rejects what is plainly not an address', () => {
    for (const bad of ['', 'nope', 'a@b', 'a b@example.com', '@example.com', 'a@@b.com', 42]) {
      assert.throws(() => normalizeEmail(bad as string), InvalidEmailError);
    }
  });
});

describe('hashEmail', () => {
  it('is stable across the shapes normalisation collapses', () => {
    assert.equal(hashEmail(' USER@Example.COM '), hashEmail('user@example.com'));
  });

  it('separates two different addresses', () => {
    assert.notEqual(hashEmail('a@example.com'), hashEmail('b@example.com'));
  });

  it('refuses to run without a pepper', () => {
    const saved = process.env.EMAIL_HMAC_PEPPER;
    delete process.env.EMAIL_HMAC_PEPPER;
    assert.throws(() => hashEmail('a@example.com'), /EMAIL_HMAC_PEPPER/);
    process.env.EMAIL_HMAC_PEPPER = saved;
  });
});

describe('encryptEmail', () => {
  it('round-trips', () => {
    assert.equal(decryptEmail(encryptEmail('nupers.sv@gmail.com')), 'nupers.sv@gmail.com');
  });

  it('produces a different ciphertext every time, so equal addresses are not linkable', () => {
    assert.notEqual(encryptEmail('a@example.com'), encryptEmail('a@example.com'));
  });

  it('refuses tampered ciphertext rather than returning a different address', () => {
    const stored = encryptEmail('a@example.com');
    const [iv, tag, data] = stored.split('.');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 0xff;
    assert.throws(() => decryptEmail([iv, tag, flipped.toString('base64url')].join('.')));
  });

  it('refuses a malformed value instead of guessing at it', () => {
    assert.throws(() => decryptEmail('not-a-ciphertext'), /Malformed/);
  });
});

describe('maskEmail', () => {
  it('keeps the domain and the first character', () => {
    const masked = maskEmail('nupers.sv@gmail.com');
    assert.ok(masked.startsWith('n'));
    assert.ok(masked.endsWith('@gmail.com'));
    assert.ok(!masked.includes('upers.s'));
  });
});

describe('email tokens', () => {
  it('matches its own token and nothing else', () => {
    const { token, hash } = createEmailToken();
    assert.equal(tokenMatches(token, hash), true);
    assert.equal(tokenMatches(createEmailToken().token, hash), false);
  });

  it('does not store anything a dump could use as a link', () => {
    const { token, hash } = createEmailToken();
    assert.notEqual(token, hash);
    assert.ok(!hash.includes(token));
  });

  it('expires an hour out', () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    assert.equal(EMAIL_TOKEN_TTL_MS, 60 * 60 * 1000);
    assert.equal(emailTokenExpiresAt(now).getTime(), now + EMAIL_TOKEN_TTL_MS);
  });
});

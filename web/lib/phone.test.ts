import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CURRENT_PHONE_HASH_VERSION,
  InvalidPhoneNumberError,
  hashPhone,
  hashPhoneLegacy,
  isPhoneHash,
  normalizePhone,
  phoneHashCandidates,
  phoneHint,
} from '@/lib/phone';

const PEPPER = 'test-pepper-value-that-is-long-enough-32';

describe('normalizePhone', () => {
  it('reaches the same number from every shape a user types it in', () => {
    const forms = ['081234567890', '+62 812-3456-7890', '62812 3456 7890', '812 3456 7890'];
    const normalized = forms.map((f) => normalizePhone(f, '62'));
    assert.deepEqual(new Set(normalized), new Set(['6281234567890']));
  });

  it('keeps two countries apart when their national digits collide', () => {
    assert.notEqual(normalizePhone('81234567', '62'), normalizePhone('81234567', '65'));
  });
});

describe('hashPhone', () => {
  it('refuses to run without a pepper, rather than hashing under an empty key', () => {
    delete process.env.PHONE_HMAC_PEPPER;
    assert.throws(() => hashPhone('081234567890', '62'), /PHONE_HMAC_PEPPER/);
  });

  it('refuses a pepper too short to be worth having', () => {
    process.env.PHONE_HMAC_PEPPER = 'short';
    assert.throws(() => hashPhone('081234567890', '62'), /PHONE_HMAC_PEPPER/);
  });

  it('produces something a hash32 column still accepts', () => {
    process.env.PHONE_HMAC_PEPPER = PEPPER;
    assert.ok(isPhoneHash(hashPhone('081234567890', '62')));
  });

  it('differs from the unkeyed hash it replaces', () => {
    process.env.PHONE_HMAC_PEPPER = PEPPER;
    assert.notEqual(hashPhone('081234567890', '62'), hashPhoneLegacy('081234567890', '62'));
  });

  it('changes completely when the pepper changes, which is the point of having one', () => {
    process.env.PHONE_HMAC_PEPPER = PEPPER;
    const withOne = hashPhone('081234567890', '62');
    process.env.PHONE_HMAC_PEPPER = 'a-different-pepper-also-long-enough-32ch';
    assert.notEqual(withOne, hashPhone('081234567890', '62'));
  });

  it('is stable for the same number and pepper', () => {
    process.env.PHONE_HMAC_PEPPER = PEPPER;
    assert.equal(hashPhone('081234567890', '62'), hashPhone('+6281234567890', '62'));
  });
});

describe('phoneHashCandidates', () => {
  it('offers the current rule first so a migrated account costs one query', () => {
    process.env.PHONE_HMAC_PEPPER = PEPPER;
    const candidates = phoneHashCandidates('081234567890', '62');

    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].version, CURRENT_PHONE_HASH_VERSION);
    assert.equal(candidates[0].hash, hashPhone('081234567890', '62'));
    assert.equal(candidates[1].version, 1);
    assert.equal(candidates[1].hash, hashPhoneLegacy('081234567890', '62'));
  });
});

describe('phoneHint', () => {
  it('gives the same four digits whatever shape the number was typed in', () => {
    const forms = ['081234567890', '+62 812-3456-7890', '62812 3456 7890', '812 3456 7890'];
    const hints = forms.map((f) => phoneHint(f, '62'));

    assert.deepEqual(new Set(hints.map((h) => h.last4)), new Set(['7890']));
    assert.deepEqual(new Set(hints.map((h) => h.dialCode)), new Set(['62']));
  });

  it('keeps back everything that carries entropy', () => {
    const { last4 } = phoneHint('081234567890', '62');
    assert.equal(last4.length, 4);
    assert.equal(normalizePhone('081234567890', '62').includes(last4), true);
    // The national number is 10 digits; four of them is not enough to reconstruct it.
    assert.equal(normalizePhone('081234567890', '62').endsWith(last4), true);
  });

  it('strips a plus from the dialling code it is handed', () => {
    assert.equal(phoneHint('812 3456 7890', '+62').dialCode, '62');
  });

  it('refuses a number that is not plausible, rather than hinting at nonsense', () => {
    assert.throws(() => phoneHint('12', '62'), InvalidPhoneNumberError);
  });
});

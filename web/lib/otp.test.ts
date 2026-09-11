import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.OTP_HMAC_PEPPER ||= 'test-otp-pepper-long-enough-to-pass-32ch';

import {
  hashOtpCode,
  isOtpExpired,
  isWellFormedOtp,
  otpExpiresAt,
  otpMatches,
  OTP_LENGTH,
  OTP_TTL_MS,
} from '@/lib/otp';

const PHONE_HASH = `0x${'ab'.repeat(32)}`;

describe('otp expiry', () => {
  it('lasts five minutes', () => {
    assert.equal(OTP_TTL_MS, 5 * 60 * 1000);
  });

  it('is still valid one second before the window closes', () => {
    const issuedAt = Date.UTC(2026, 0, 1, 12, 0, 0);
    const expiresAt = otpExpiresAt(issuedAt);
    assert.equal(isOtpExpired(expiresAt, issuedAt + OTP_TTL_MS - 1000), false);
  });

  it('is dead once exactly five minutes have passed', () => {
    const issuedAt = Date.UTC(2026, 0, 1, 12, 0, 0);
    const expiresAt = otpExpiresAt(issuedAt);
    assert.equal(isOtpExpired(expiresAt, issuedAt + OTP_TTL_MS), true);
  });

  it('stays dead afterwards', () => {
    const issuedAt = Date.UTC(2026, 0, 1, 12, 0, 0);
    const expiresAt = otpExpiresAt(issuedAt);
    assert.equal(isOtpExpired(expiresAt, issuedAt + OTP_TTL_MS + 60_000), true);
  });

  it('reads an ISO string the same way it reads a Date, since that is what the row holds', () => {
    const issuedAt = Date.UTC(2026, 0, 1, 12, 0, 0);
    const expiresAt = otpExpiresAt(issuedAt).toISOString();
    assert.equal(isOtpExpired(expiresAt, issuedAt + 1000), false);
    assert.equal(isOtpExpired(expiresAt, issuedAt + OTP_TTL_MS + 1), true);
  });
});

describe('otp shape and matching', () => {
  it('accepts only a code of the declared length', () => {
    assert.equal(isWellFormedOtp('1'.repeat(OTP_LENGTH)), true);
    assert.equal(isWellFormedOtp('1'.repeat(OTP_LENGTH - 1)), false);
    assert.equal(isWellFormedOtp('1'.repeat(OTP_LENGTH + 1)), false);
    assert.equal(isWellFormedOtp('12a456'), false);
    assert.equal(isWellFormedOtp(123456), false);
  });

  it('matches a code against its own stored hmac', () => {
    const stored = hashOtpCode('123456', PHONE_HASH);
    assert.equal(otpMatches('123456', PHONE_HASH, stored), true);
    assert.equal(otpMatches('123457', PHONE_HASH, stored), false);
  });

  it('will not accept the right code for the wrong number', () => {
    const stored = hashOtpCode('123456', PHONE_HASH);
    assert.equal(otpMatches('123456', `0x${'cd'.repeat(32)}`, stored), false);
  });
});

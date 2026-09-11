import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MALFORMED_OTP, otpFailureMessage } from '@/lib/otp-message';

describe('otpFailureMessage', () => {
  it('says a wrong code is wrong, and how many tries are left', () => {
    const message = otpFailureMessage('wrong_code', 2);
    assert.equal(message.code, 'INCORRECT_OTP');
    assert.match(message.error, /not right/i);
    assert.match(message.error, /2 tries left/);
  });

  it('says "try" rather than "tries" for the last one', () => {
    assert.match(otpFailureMessage('wrong_code', 1).error, /1 try left/);
  });

  it('drops the count at zero, where "0 tries left" would contradict itself', () => {
    const message = otpFailureMessage('wrong_code', 0);
    assert.equal(message.code, 'INCORRECT_OTP');
    assert.doesNotMatch(message.error, /left/);
  });

  it('says an expired code is expired, not "incorrect or expired"', () => {
    const message = otpFailureMessage('expired');
    assert.equal(message.code, 'EXPIRED_OTP');
    assert.match(message.error, /expired/i);
    assert.doesNotMatch(message.error, /incorrect/i);
  });

  it('gives a never-requested code the same answer as an expired one', () => {
    // The one distinction deliberately not drawn: telling these apart would reveal whether a
    // login is in flight for a number an attacker merely knows.
    assert.deepEqual(otpFailureMessage('no_challenge'), otpFailureMessage('expired'));
  });

  it('says the attempts are gone rather than blaming the digits', () => {
    const message = otpFailureMessage('attempts_exhausted');
    assert.equal(message.code, 'OTP_ATTEMPTS_EXHAUSTED');
    assert.match(message.error, /too many/i);
  });

  it('treats a lost race as an exhausted challenge, since nothing is left to try on it', () => {
    assert.deepEqual(otpFailureMessage('raced'), otpFailureMessage('attempts_exhausted'));
  });

  it('never lumps incorrect and expired into one message again', () => {
    const wrong = otpFailureMessage('wrong_code', 2);
    const expired = otpFailureMessage('expired');
    assert.notEqual(wrong.error, expired.error);
    assert.notEqual(wrong.code, expired.code);
  });

  it('points a malformed code at the digits, and counts as incorrect', () => {
    assert.equal(MALFORMED_OTP.code, 'INCORRECT_OTP');
    assert.match(MALFORMED_OTP.error, /6 digits/);
  });

  it('offers a way forward on every failure', () => {
    for (const reason of ['wrong_code', 'expired', 'no_challenge', 'attempts_exhausted', 'raced'] as const) {
      assert.ok(otpFailureMessage(reason, 1).error.length > 0);
    }
  });
});

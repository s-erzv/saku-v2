import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isSimulatedPayout, payoutProvider } from '@/lib/offramp-payout';

describe('isSimulatedPayout', () => {
  it('reads the MOCK- prefix lib/mock-fiat.ts promises to always write', () => {
    assert.equal(isSimulatedPayout('MOCK-DISB-LZ8K2P-A91X4C'), true);
  });

  it('treats a Xendit disbursement id as real', () => {
    assert.equal(isSimulatedPayout('5f5f0b2b1e2f3a0017a1b2c3'), false);
  });

  it('calls an absent reference simulated, never real', () => {
    // Wrong in the cautious direction on purpose: overstating a payout is a false claim about
    // someone's money, understating it is a support question.
    assert.equal(isSimulatedPayout(null), true);
    assert.equal(isSimulatedPayout(undefined), true);
    assert.equal(isSimulatedPayout(''), true);
  });
});

describe('payoutProvider', () => {
  it('names Xendit only when the reference is one of theirs', () => {
    assert.equal(payoutProvider('5f5f0b2b1e2f3a0017a1b2c3'), 'Xendit');
    assert.match(payoutProvider('MOCK-DISB-XYZ'), /Simulated/);
    assert.match(payoutProvider(null), /Simulated/);
  });
});

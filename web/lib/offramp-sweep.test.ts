import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  decideFromChain,
  ESCROW_STATUS,
  isSweepable,
  SWEEP_GRACE_MS,
  sweepCutoff,
  type SweepableRow,
} from '@/lib/offramp-sweep';

const NOW = Date.UTC(2026, 8, 12, 9, 0, 0);

function row(overrides: Partial<SweepableRow> = {}): SweepableRow {
  return {
    id: 'o-1',
    request_id: '0xabc',
    status: 'locked',
    // Expired well past the grace period by default.
    rate_expires_at: new Date(NOW - 10 * 60 * 1000).toISOString(),
    amount: '2000000',
    user_id: 'u-1',
    ...overrides,
  };
}

describe('sweep selection', () => {
  it('takes a lock that expired past the grace period', () => {
    assert.equal(isSweepable(row(), NOW), true);
  });

  it('leaves a lock alone until the grace period has fully passed', () => {
    const justExpired = new Date(NOW - SWEEP_GRACE_MS).toISOString();
    assert.equal(isSweepable(row({ rate_expires_at: justExpired }), NOW), false);

    const oneMsLater = new Date(NOW - SWEEP_GRACE_MS - 1).toISOString();
    assert.equal(isSweepable(row({ rate_expires_at: oneMsLater }), NOW), true);
  });

  it('leaves a lock alone while the rate is still live', () => {
    const future = new Date(NOW + 60 * 1000).toISOString();
    assert.equal(isSweepable(row({ rate_expires_at: future }), NOW), false);
  });

  it('ignores any row that is not locked, however old', () => {
    for (const status of ['settled', 'refunded', 'pending_lock']) {
      assert.equal(isSweepable(row({ status }), NOW), false);
    }
  });

  it('ignores a row whose expiry cannot be read, rather than treating it as expired', () => {
    assert.equal(isSweepable(row({ rate_expires_at: 'not a date' }), NOW), false);
  });

  it('offsets the query cutoff by the grace period', () => {
    assert.equal(sweepCutoff(NOW), new Date(NOW - SWEEP_GRACE_MS).toISOString());
  });
});

describe('what the chain says to do', () => {
  const expired = NOW - 10 * 60 * 1000;

  it('refunds a request the escrow still holds as locked', () => {
    assert.deepEqual(decideFromChain(ESCROW_STATUS.Locked, expired, NOW), { action: 'refund' });
  });

  it('never refunds twice — a refunded request is only written down', () => {
    assert.deepEqual(decideFromChain(ESCROW_STATUS.Refunded, expired, NOW), {
      action: 'reconcile',
      status: 'refunded',
    });
  });

  it('writes down a settlement the database missed instead of refunding it', () => {
    assert.deepEqual(decideFromChain(ESCROW_STATUS.Settled, expired, NOW), {
      action: 'reconcile',
      status: 'settled',
    });
  });

  it('skips a request the escrow has never heard of', () => {
    const decision = decideFromChain(ESCROW_STATUS.None, expired, NOW);
    assert.equal(decision.action, 'skip');
  });

  it('skips a locked request whose deadline is inside the grace period, so gas is not burnt on a revert', () => {
    const decision = decideFromChain(ESCROW_STATUS.Locked, NOW - SWEEP_GRACE_MS, NOW);
    assert.equal(decision.action, 'skip');

    // The contract refuses while `block.timestamp <= deadline`; one millisecond past the grace
    // period is the first moment this is worth a transaction.
    assert.deepEqual(decideFromChain(ESCROW_STATUS.Locked, NOW - SWEEP_GRACE_MS - 1, NOW), {
      action: 'refund',
    });
  });

  it('skips a locked request whose rate lock is still live', () => {
    const decision = decideFromChain(ESCROW_STATUS.Locked, NOW + 60 * 1000, NOW);
    assert.equal(decision.action, 'skip');
  });
});

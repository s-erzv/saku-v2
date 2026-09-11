import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canCompleteRecovery,
  canReplaceOpenRecovery,
  isRecoveryExpired,
  RECOVERY_FINISH_WINDOW_MS,
  RECOVERY_WINDOW_MS,
  recoveryExpiresAt,
  recoveryFinishExpiresAt,
  recoveryStage,
  requiredGuardianApprovals,
  type RecoveryRequestRow,
} from '@/lib/recovery';

const NOW = Date.UTC(2026, 2, 1, 12, 0, 0);

function request(overrides: Partial<RecoveryRequestRow> = {}): RecoveryRequestRow {
  return {
    id: 'r-1',
    status: 'pending',
    email_verified_at: new Date(NOW).toISOString(),
    guardian_approved_at: new Date(NOW).toISOString(),
    expires_at: recoveryExpiresAt(NOW).toISOString(),
    ...overrides,
  };
}

describe('recovery window', () => {
  it('is seven days', () => {
    assert.equal(RECOVERY_WINDOW_MS, 7 * 24 * 60 * 60 * 1000);
  });

  it('expires exactly at the boundary, not a moment before', () => {
    const row = request();
    assert.equal(isRecoveryExpired(row, NOW + RECOVERY_WINDOW_MS - 1), false);
    assert.equal(isRecoveryExpired(row, NOW + RECOVERY_WINDOW_MS), true);
  });
});

describe('finish window', () => {
  it('is twenty-four hours', () => {
    assert.equal(RECOVERY_FINISH_WINDOW_MS, 24 * 60 * 60 * 1000);
  });

  it('closes the last step a day after approval, even with most of the week left', () => {
    // Approval rewrites `expires_at` to this. The finish link is the most powerful thing the flow
    // sends, so it must not inherit the rest of the week.
    const row = request({ expires_at: recoveryFinishExpiresAt(NOW).toISOString() });
    assert.equal(canCompleteRecovery(row, NOW + RECOVERY_FINISH_WINDOW_MS - 1), true);
    assert.equal(canCompleteRecovery(row, NOW + RECOVERY_FINISH_WINDOW_MS), false);
  });
});

describe('requiredGuardianApprovals', () => {
  it('needs every guardian up to two, and two of three', () => {
    assert.equal(requiredGuardianApprovals(1), 1);
    assert.equal(requiredGuardianApprovals(2), 2);
    assert.equal(requiredGuardianApprovals(3), 2);
  });

  it('is always a strict majority, never more than the panel', () => {
    // The two failures this sits between: a minority deciding, and a demand nobody can meet.
    for (let panel = 1; panel <= 10; panel++) {
      const required = requiredGuardianApprovals(panel);
      assert.ok(required * 2 > panel, `a minority decided for a panel of ${panel}`);
      assert.ok(required <= panel, `more approvals than guardians for a panel of ${panel}`);
    }
  });

  it('leaves room for one unreachable guardian from three up', () => {
    for (let panel = 3; panel <= 10; panel++) {
      assert.ok(requiredGuardianApprovals(panel) < panel);
    }
  });
});

describe('canCompleteRecovery', () => {
  it('accepts only when every proof is in', () => {
    assert.equal(canCompleteRecovery(request(), NOW), true);
  });

  it('refuses without the email', () => {
    assert.equal(canCompleteRecovery(request({ email_verified_at: null }), NOW), false);
  });

  it('refuses before the guardian majority, even with the email verified', () => {
    // The whole argument for guardians: an email account is itself a takeover target, so an
    // account protected by email alone must not be recoverable by email alone.
    assert.equal(canCompleteRecovery(request({ guardian_approved_at: null }), NOW), false);
  });

  it('refuses an expired request however complete it looks', () => {
    assert.equal(canCompleteRecovery(request(), NOW + RECOVERY_WINDOW_MS), false);
  });

  it('refuses a request that already resolved, so it cannot be replayed', () => {
    for (const status of ['approved', 'rejected', 'expired'] as const) {
      assert.equal(canCompleteRecovery(request({ status }), NOW), false);
    }
  });
});

describe('canReplaceOpenRecovery', () => {
  it('lets a new start replace a request nobody has confirmed', () => {
    // Otherwise a stranger who knows the number could park an unconfirmable request and lock the
    // owner out of recovery for a week.
    assert.equal(
      canReplaceOpenRecovery(request({ email_verified_at: null, guardian_approved_at: null }), NOW),
      true
    );
  });

  it('protects a request the owner has already confirmed', () => {
    // Starting needs only the old number. If this were replaceable, anyone who knew it could
    // cancel a recovery that is only waiting on guardians.
    assert.equal(canReplaceOpenRecovery(request({ guardian_approved_at: null }), NOW), false);
    assert.equal(canReplaceOpenRecovery(request(), NOW), false);
  });

  it('lets an expired request be replaced whatever it had reached', () => {
    assert.equal(canReplaceOpenRecovery(request(), NOW + RECOVERY_WINDOW_MS), true);
  });
});

describe('recoveryStage', () => {
  it('walks the steps in order', () => {
    assert.equal(
      recoveryStage(request({ email_verified_at: null, guardian_approved_at: null }), NOW),
      'awaiting_email'
    );
    assert.equal(recoveryStage(request({ guardian_approved_at: null }), NOW), 'awaiting_guardian');
    assert.equal(recoveryStage(request(), NOW), 'choose_number');
    assert.equal(recoveryStage(request({ status: 'approved' }), NOW), 'done');
    assert.equal(recoveryStage(request(), NOW + RECOVERY_WINDOW_MS), 'expired');
  });

  it('tells a rejection apart from an expiry', () => {
    assert.equal(recoveryStage(request({ status: 'rejected' }), NOW), 'rejected');
    assert.equal(recoveryStage(request({ status: 'expired' }), NOW), 'expired');
  });

  it('never offers the new-number step when the gate would refuse', () => {
    const rows = [
      request(),
      request({ email_verified_at: null }),
      request({ guardian_approved_at: null }),
      request({ status: 'rejected' }),
    ];
    for (const row of rows) {
      for (const at of [NOW, NOW + RECOVERY_WINDOW_MS + 1]) {
        assert.equal(recoveryStage(row, at) === 'choose_number', canCompleteRecovery(row, at));
      }
    }
  });
});

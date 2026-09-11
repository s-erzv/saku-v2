import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isGuardianReachable,
  GUARDIAN_COOLING_PERIOD_MS,
  guardianCooldownRemainingMs,
  guardianDisplayState,
  guardianEffectiveAt,
  hasRecoveryPath,
  isGuardianEligible,
  isRecoveryReady,
  MAX_GUARDIANS,
  nextGuardianActiveAt,
  type GuardianRow,
} from '@/lib/guardians';

const NOW = Date.UTC(2026, 0, 10, 9, 0, 0);

function guardian(overrides: Partial<GuardianRow> = {}): GuardianRow {
  return {
    id: 'g-1',
    status: 'pending',
    approved_at: new Date(NOW).toISOString(),
    effective_at: guardianEffectiveAt(NOW).toISOString(),
    ...overrides,
  };
}

describe('cooling period', () => {
  it('is twenty-four hours', () => {
    assert.equal(GUARDIAN_COOLING_PERIOD_MS, 24 * 60 * 60 * 1000);
  });

  it('runs from the approval, not from the invitation', () => {
    const approvedAt = NOW + 3 * 24 * 60 * 60 * 1000;
    assert.equal(
      guardianEffectiveAt(approvedAt).getTime(),
      approvedAt + GUARDIAN_COOLING_PERIOD_MS
    );
  });
});

describe('isGuardianEligible', () => {
  it('refuses an invitation nobody has answered', () => {
    assert.equal(isGuardianEligible(guardian({ status: 'invited', approved_at: null }), NOW), false);
  });

  it('refuses an approved guardian while the cooling period is still running', () => {
    assert.equal(isGuardianEligible(guardian(), NOW + 60_000), false);
  });

  it('still refuses one second before the period is up', () => {
    assert.equal(isGuardianEligible(guardian(), NOW + GUARDIAN_COOLING_PERIOD_MS - 1000), false);
  });

  it('accepts once the period has elapsed', () => {
    assert.equal(isGuardianEligible(guardian(), NOW + GUARDIAN_COOLING_PERIOD_MS), true);
  });

  it('refuses a revoked guardian however long ago they were approved', () => {
    const revoked = guardian({ status: 'revoked' });
    assert.equal(isGuardianEligible(revoked, NOW + 90 * 24 * 60 * 60 * 1000), false);
  });

  it('does not trust the status string on its own', () => {
    // A row claiming to be approved while its clock says otherwise must still be refused —
    // the status is display copy, the timestamps are the gate.
    const mislabelled = guardian({ status: 'approved' });
    assert.equal(isGuardianEligible(mislabelled, NOW + 1000), false);
  });
});

describe('guardianDisplayState', () => {
  it('separates the three states the owner can act on', () => {
    assert.equal(
      guardianDisplayState(guardian({ status: 'invited', approved_at: null }), NOW),
      'awaiting_response'
    );
    assert.equal(guardianDisplayState(guardian(), NOW + 60_000), 'cooling_down');
    assert.equal(guardianDisplayState(guardian(), NOW + GUARDIAN_COOLING_PERIOD_MS), 'active');
    assert.equal(guardianDisplayState(guardian({ status: 'revoked' }), NOW), 'revoked');
  });

  it('never says active while the gate would refuse', () => {
    for (let elapsed = 0; elapsed < GUARDIAN_COOLING_PERIOD_MS; elapsed += 60 * 60 * 1000) {
      const row = guardian();
      const shown = guardianDisplayState(row, NOW + elapsed);
      assert.equal(shown === 'active', isGuardianEligible(row, NOW + elapsed));
    }
  });
});

describe('guardianCooldownRemainingMs', () => {
  it('counts down and stops at zero', () => {
    assert.equal(guardianCooldownRemainingMs(guardian(), NOW), GUARDIAN_COOLING_PERIOD_MS);
    assert.equal(
      guardianCooldownRemainingMs(guardian(), NOW + GUARDIAN_COOLING_PERIOD_MS + 5000),
      0
    );
  });

  it('is zero for an invitation nobody has answered', () => {
    assert.equal(
      guardianCooldownRemainingMs(guardian({ status: 'invited', approved_at: null }), NOW),
      0
    );
  });
});

describe('hasRecoveryPath', () => {
  it('is false for an account with neither factor', () => {
    assert.equal(hasRecoveryPath({ emailVerified: false, guardians: [], nowMs: NOW }), false);
  });

  it('is false when the only guardian has not been approved yet', () => {
    const pending = [guardian({ status: 'invited', approved_at: null })];
    assert.equal(hasRecoveryPath({ emailVerified: false, guardians: pending, nowMs: NOW }), false);
  });

  it('is false while the only guardian is still cooling down', () => {
    assert.equal(
      hasRecoveryPath({ emailVerified: false, guardians: [guardian()], nowMs: NOW + 60_000 }),
      false
    );
  });

  it('is true once that guardian matures', () => {
    assert.equal(
      hasRecoveryPath({
        emailVerified: false,
        guardians: [guardian()],
        nowMs: NOW + GUARDIAN_COOLING_PERIOD_MS,
      }),
      true
    );
  });

  it('is true on a verified email alone — setup has started, even though it is not ready', () => {
    assert.equal(hasRecoveryPath({ emailVerified: true, guardians: [], nowMs: NOW }), true);
  });
});

describe('isRecoveryReady', () => {
  const matured = NOW + GUARDIAN_COOLING_PERIOD_MS;

  it('needs both a verified email and an active guardian', () => {
    assert.equal(isRecoveryReady({ emailVerified: true, guardians: [guardian()], nowMs: matured }), true);
  });

  it('is not ready on an email alone', () => {
    // The state that used to read "Recovery is on" while a real recovery refused the owner.
    assert.equal(isRecoveryReady({ emailVerified: true, guardians: [], nowMs: matured }), false);
  });

  it('is not ready while the only guardian is still cooling down', () => {
    assert.equal(isRecoveryReady({ emailVerified: true, guardians: [guardian()], nowMs: NOW + 60_000 }), false);
  });

  it('is not ready on an active guardian without an email', () => {
    assert.equal(isRecoveryReady({ emailVerified: false, guardians: [guardian()], nowMs: matured }), false);
  });
});

describe('nextGuardianActiveAt', () => {
  it('gives the soonest cooling guardian', () => {
    const later = guardian({ id: 'g-2', effective_at: guardianEffectiveAt(NOW + 5000).toISOString() });
    assert.equal(
      nextGuardianActiveAt([later, guardian()], NOW + 60_000)?.getTime(),
      NOW + GUARDIAN_COOLING_PERIOD_MS
    );
  });

  it('is null when nobody is on the way', () => {
    assert.equal(nextGuardianActiveAt([], NOW), null);
    // An unanswered invitation may never be accepted, so it has no date to give.
    assert.equal(nextGuardianActiveAt([guardian({ status: 'invited', approved_at: null })], NOW), null);
    assert.equal(nextGuardianActiveAt([guardian({ status: 'revoked' })], NOW), null);
    assert.equal(nextGuardianActiveAt([guardian()], NOW + GUARDIAN_COOLING_PERIOD_MS), null);
  });
});

describe('MAX_GUARDIANS', () => {
  it('matches the cap the database trigger enforces', () => {
    assert.equal(MAX_GUARDIANS, 3);
  });
});

describe('isGuardianReachable', () => {
  it('accepts a guardian who has a Saku account', () => {
    assert.equal(isGuardianReachable({ guardian_user_id: 'u1' }), true);
  });

  it('accepts a guardian held only by an invited number', () => {
    assert.equal(isGuardianReachable({ invite_phone_ciphertext: 'iv.tag.data' }), true);
  });

  it('rejects a guardian with neither, who would raise the majority without ever voting', () => {
    assert.equal(isGuardianReachable({}), false);
    assert.equal(
      isGuardianReachable({ guardian_user_id: null, invite_phone_ciphertext: null }),
      false
    );
  });

  it('is what keeps a phone-only guardian on the panel', () => {
    const panel = [
      { guardian_user_id: 'u1', invite_phone_ciphertext: null },
      { guardian_user_id: null, invite_phone_ciphertext: 'iv.tag.data' },
      { guardian_user_id: null, invite_phone_ciphertext: null },
    ];
    // The old test was `.filter(g => g.guardian_user_id)`, which silently dropped the second.
    assert.equal(panel.filter(isGuardianReachable).length, 2);
  });
});

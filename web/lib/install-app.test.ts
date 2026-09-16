import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  INSTALL_PROMPT_COOLDOWN_MS,
  installPromptCooldownRemaining,
  isPhoneUserAgent,
  shouldOfferInstall,
} from '@/lib/install-app';

describe('mobile app install eligibility', () => {
  it('recognises phone browsers without treating a laptop as mobile', () => {
    assert.equal(isPhoneUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), true);
    assert.equal(isPhoneUserAgent('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit Mobile'), true);
    assert.equal(isPhoneUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), false);
  });

  it('trusts User-Agent Client Hints when the browser provides them', () => {
    assert.equal(isPhoneUserAgent('desktop-looking fallback', true), true);
    assert.equal(isPhoneUserAgent('Android Mobile', false), false);
  });

  it('requires both a real phone and a mobile viewport', () => {
    assert.equal(
      shouldOfferInstall({ phone: false, mobileViewport: true, installedSurface: false }),
      false
    );
    assert.equal(
      shouldOfferInstall({ phone: true, mobileViewport: false, installedSurface: false }),
      false
    );
    assert.equal(
      shouldOfferInstall({ phone: true, mobileViewport: true, installedSurface: false }),
      true
    );
  });

  it('never advertises installation inside an installed or mini-app surface', () => {
    assert.equal(
      shouldOfferInstall({ phone: true, mobileViewport: true, installedSurface: true }),
      false
    );
  });
});

describe('install prompt cooldown', () => {
  it('lasts exactly twelve hours and expires at the boundary', () => {
    const now = Date.UTC(2026, 8, 16, 8);
    const until = now + INSTALL_PROMPT_COOLDOWN_MS;

    assert.equal(INSTALL_PROMPT_COOLDOWN_MS, 43_200_000);
    assert.equal(installPromptCooldownRemaining(until, now), INSTALL_PROMPT_COOLDOWN_MS);
    assert.equal(installPromptCooldownRemaining(until, until), 0);
  });
});

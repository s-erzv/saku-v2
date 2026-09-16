export const INSTALL_PROMPT_COOLDOWN_MS = 12 * 60 * 60 * 1000;

export function isPhoneUserAgent(userAgent: string, mobileHint?: boolean): boolean {
  if (typeof mobileHint === 'boolean') return mobileHint;
  return /iPhone|iPod|Windows Phone|IEMobile|Opera Mini|Android.+Mobile/i.test(userAgent);
}

export function shouldOfferInstall({
  phone,
  mobileViewport,
  installedSurface,
}: {
  phone: boolean;
  mobileViewport: boolean;
  installedSurface: boolean;
}): boolean {
  return phone && mobileViewport && !installedSurface;
}

export function installPromptCooldownRemaining(dismissedUntil: number, now = Date.now()): number {
  return Math.max(0, dismissedUntil - now);
}

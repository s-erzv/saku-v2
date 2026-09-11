/**
 * The cookie that carries a recovery's finish link from the email to the last step.
 *
 * The finish link arrives as `?token=` in a URL, which is the wrong place for it to stay: the
 * address bar ends up in history, screenshots and shared tabs, and the page it lands on is running
 * script. So `/api/recovery/continue` swaps it for this cookie and redirects straight away.
 *
 * Scoped to `/api/recovery`, because the only request that ever needs it is the one that finishes
 * the recovery. No page, and no other API route, is sent it.
 */

import type { NextRequest, NextResponse } from 'next/server';

export const RECOVERY_TICKET_COOKIE = 'saku_recovery';

const PATH = '/api/recovery';

function options(maxAge: number) {
  return {
    httpOnly: true,
    // Same reasoning as the session cookie: required in production, and off on localhost only
    // because a Secure cookie over plain HTTP is silently never stored.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: PATH,
    maxAge,
  };
}

/** Lives exactly as long as the request it belongs to, so it cannot outlast the finish window. */
export function setRecoveryTicket(response: NextResponse, token: string, expiresAt: Date): NextResponse {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  response.cookies.set(RECOVERY_TICKET_COOKIE, token, options(maxAge));
  return response;
}

export function readRecoveryTicket(request: NextRequest): string | null {
  return request.cookies.get(RECOVERY_TICKET_COOKIE)?.value || null;
}

/** `maxAge: 0` with matching attributes, for the same reason `clearSessionCookie` does it. */
export function clearRecoveryTicket(response: NextResponse): NextResponse {
  response.cookies.set(RECOVERY_TICKET_COOKIE, '', options(0));
  return response;
}

/**
 * Where a Saku session lives, and what it takes to use one.
 *
 * The session used to be a bearer token in `localStorage`, read by page scripts and attached to
 * every request by hand. That made one bug catastrophic: any script injection anywhere in the
 * app could read the token, post it somewhere, and the attacker then held the full authority to
 * move that user's money — from their own machine, for the token's whole life, with the real
 * user's browser closed. The app's own CSP allowed `unsafe-inline` and `unsafe-eval` at the time,
 * so that was not a hypothetical distance away.
 *
 * The token is now an httpOnly cookie. Script cannot read it, which turns the worst case of an
 * injection from "the attacker keeps the wallet" into "the attacker can act while the tab is
 * open" — still bad, but bounded, observable in `signing_events`, and capped by
 * `lib/spend-limits.ts`.
 *
 * Two consequences of moving to a cookie, both handled here:
 *
 *  - **Cookies are sent by the browser automatically, including on requests a hostile page
 *    causes.** That is CSRF, and it did not exist while the token was a header. `SameSite=Lax`
 *    stops it for every state-changing method; {@link assertSameOrigin} is the second lock, for
 *    the browsers and edge cases where it does not.
 *  - **Lax, not Strict**, deliberately: packet and payment links are opened from WhatsApp, which
 *    is a cross-site navigation. Under `Strict` the cookie is withheld on that first hop and the
 *    recipient lands on the app looking signed out. Lax sends it on top-level GETs and withholds
 *    it on cross-site POSTs, which is exactly the line we want.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyToken, SESSION_TTL_SECONDS } from '@/lib/jwt';

export const SESSION_COOKIE = 'saku_session';

export interface Session {
  userId: string;
  /** keccak256 of the caller's phone number. The plain number is never in the session. */
  phoneHash: string;
  version: number;
  /** Seconds since epoch when this token expires — used to decide whether to slide it forward. */
  expiresAt: number;
}

/** Read one cookie out of a request without pulling in `next/headers`. */
function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? decodeURIComponent(value) : null;
  }
  return null;
}

/**
 * Reject a state-changing request that did not come from Saku's own pages.
 *
 * Belt to `SameSite=Lax`'s braces. `Origin` is set by the browser on every cross-origin request
 * and on same-origin non-GET requests, and cannot be forged by page script. When it is absent —
 * some same-origin cases, and non-browser clients — `Sec-Fetch-Site` answers the same question;
 * when neither is present the request is not from a browser we can vouch for, and a route that
 * moves money is not the place to give it the benefit of the doubt.
 */
export function assertSameOrigin(request: Request): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return true;

  const origin = request.headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).host === new URL(request.url).host;
    } catch {
      return false;
    }
  }

  const site = request.headers.get('sec-fetch-site');
  return site === 'same-origin' || site === 'none';
}

/**
 * Resolve the caller's session, or null.
 *
 * Three things must hold, and all three are checked here so no route can forget one:
 * the cookie's signature verifies, the request is same-origin if it changes anything, and the
 * token's version still matches the user's. That last check is what makes signing out mean
 * something — see `lib/jwt.ts`.
 */
export async function getSession(request: Request): Promise<Session | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  if (!assertSameOrigin(request)) return null;

  let payload;
  try {
    payload = await verifyToken(token);
  } catch {
    return null;
  }

  try {
    const { data: user, error } = await getSupabaseAdmin()
      .from('users')
      .select('token_version')
      .eq('id', payload.userId)
      .maybeSingle();

    if (error) throw error;
    // The token verified, but its subject is gone — a deleted account, or a token minted against
    // a database that has since been replaced. Treat it as signed out.
    if (!user) return null;
    if ((user.token_version ?? 0) !== payload.version) return null;
  } catch (error) {
    // Fail closed. A database that cannot answer "is this session still live?" must not be read
    // as "yes" — that would turn an outage into an open door for every revoked token at once.
    console.error('[session] could not verify token version:', error);
    return null;
  }

  return {
    userId: payload.userId,
    phoneHash: payload.phoneHash,
    version: payload.version,
    expiresAt: payload.exp ?? 0,
  };
}

/** The 401 every route returns for an absent, expired, revoked, or cross-site session. */
export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    // Cookies without this are sent over plain HTTP, where anything on the path can read them.
    // Off in development because localhost is not served over TLS and the cookie would simply
    // never be stored, which looks like a broken login rather than a missing flag.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

/** Attach a freshly minted session to a response. */
export function setSessionCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_TTL_SECONDS));
  return response;
}

/**
 * Drop the session cookie.
 *
 * `maxAge: 0` rather than deleting, so the attributes match the cookie that was set — a browser
 * will not clear a cookie it cannot match on path and security flags, and a sign-out that
 * silently leaves the cookie in place is the worst possible outcome for this function.
 */
export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE, '', cookieOptions(0));
  return response;
}

/**
 * Renew a session that is more than halfway through its life.
 *
 * Called from `/api/me`, which every screen hits on load. The effect is that someone who uses the
 * app stays signed in indefinitely while a token copied off a device that then goes quiet expires
 * within {@link SESSION_TTL_SECONDS}. Renewing on every request instead would write a
 * `Set-Cookie` on every response for no benefit.
 */
export function shouldRenew(session: Session): boolean {
  const secondsLeft = session.expiresAt - Math.floor(Date.now() / 1000);
  return secondsLeft < SESSION_TTL_SECONDS / 2;
}

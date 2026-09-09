/**
 * Saku session tokens.
 *
 * Three properties that are security-relevant, not stylistic:
 *
 *  1. The secret has no fallback. v1 read `process.env.JWT_SECRET || 'your-super-secret-...'`, so
 *     a deployment that forgot the env var kept working — signing every session with a string
 *     published in the repository. It throws at first use instead.
 *  2. The payload carries `phoneHash`, not the phone number. Nothing downstream needs a plain
 *     number, so none is put where it can leak (PRD Section 1).
 *  3. The payload carries a **version**, checked against `users.token_version` on every request
 *     (`lib/session.ts`). Without it a token was valid for its whole lifetime no matter what:
 *     signing out only cleared the browser's copy, so a token that had already been captured kept
 *     working for days and there was no way, anywhere, to stop it. Bumping the column now
 *     invalidates every token ever issued to that user, immediately.
 *
 * The token itself is delivered as an httpOnly cookie and is never handed to page scripts — see
 * `lib/session.ts` for why that matters more than anything on this list.
 */

import { SignJWT, jwtVerify } from 'jose';

export interface SakuJWTPayload {
  /** keccak256 of the user's phone number — see `lib/phone.ts`. */
  phoneHash: string;
  /** `users.id`. */
  userId: string;
  /** Must equal `users.token_version`, or the session is dead. */
  version: number;
  iat?: number;
  exp?: number;
}

/**
 * How long a session lasts without being renewed.
 *
 * Was seven days. A wallet session is the authority to move money, and a week is a long time for
 * a captured one to stay useful; `/api/me` slides this forward on every visit (see
 * `lib/session.ts`), so a person who opens the app at all is never signed out by it, while a
 * token lifted from a device that then stops being used expires within a day.
 */
export const SESSION_TTL_SECONDS = 24 * 60 * 60;

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET is missing or shorter than 32 characters');
  }
  return new TextEncoder().encode(secret);
}

export async function generateToken(payload: {
  phoneHash: string;
  userId: string;
  version: number;
}): Promise<string> {
  return new SignJWT({ phoneHash: payload.phoneHash, ver: payload.version })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

/**
 * Verify and decode a session token. This proves the token was minted here and has not expired.
 * It does **not** prove the session is still live — only `lib/session.ts` does that, by checking
 * the version against the database.
 *
 * @throws when the token is malformed, expired, signed with another key, or missing claims.
 *         Callers must treat any throw as "not authenticated" and never fall through.
 */
export async function verifyToken(token: string): Promise<SakuJWTPayload> {
  // Pinning the algorithm matters: without it, a token could arrive with `alg` set to
  // something the verifier accepts on different terms.
  const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ['HS256'] });

  const phoneHash = payload.phoneHash as string;
  const userId = payload.sub;
  const version = payload.ver;

  // A token minted before `ver` existed has no business being honoured now: it predates
  // revocation entirely, so it is exactly the token this check was added to kill.
  if (!phoneHash || !userId || typeof version !== 'number') {
    throw new Error('Invalid token payload');
  }

  return { phoneHash, userId, version, iat: payload.iat, exp: payload.exp };
}

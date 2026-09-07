/**
 * Saku session tokens.
 *
 * Two changes from v1 that are security-relevant, not stylistic:
 *
 *  1. The secret no longer falls back to a hardcoded default. v1 read
 *     `process.env.JWT_SECRET || 'your-super-secret-jwt-key-min-32-chars-long'`, so a
 *     deployment that forgot the env var kept working — signing every session with a string
 *     published in the repository. Anyone could then mint a valid token for any user. It now
 *     throws at first use instead.
 *  2. The payload carries `phoneHash`, not the phone number. This token lives in localStorage
 *     and rides along on every API call; there is no reason for a plain phone number to be in
 *     it when nothing downstream needs one (PRD Section 1).
 *
 * This is the Saku *session* token, signed HS256 with a shared secret. It is what `/api/mpc/sign`
 * checks before asking Turnkey to sign anything — see docs/mpc-setup.md.
 */

import { SignJWT, jwtVerify } from 'jose';

export interface SakuJWTPayload {
  /** keccak256 of the user's phone number — see `lib/phone.ts`. */
  phoneHash: string;
  /** `users.id`. */
  userId: string;
  iat?: number;
  exp?: number;
}

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET is missing or shorter than 32 characters');
  }
  return new TextEncoder().encode(secret);
}

export async function generateToken(
  payload: { phoneHash: string; userId: string },
  expiresIn: string = '7d'
): Promise<string> {
  return new SignJWT({ phoneHash: payload.phoneHash })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getSecretKey());
}

/**
 * Verify and decode a session token.
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

  if (!phoneHash || !userId) throw new Error('Invalid token payload');

  return { phoneHash, userId, iat: payload.iat, exp: payload.exp };
}

/** Pull a bearer token out of an Authorization header. Returns null when absent or malformed. */
export function extractTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

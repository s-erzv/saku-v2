/**
 * Turning an email address into something storable.
 *
 * Two representations, because the two jobs genuinely conflict. Recovery has to *find* an
 * account from an address typed into a form, which wants a deterministic hash. Fase 5 has to
 * *warn* the address being replaced, which wants the address back. A hash cannot do the second
 * and plaintext should not do the first, so the row carries both.
 *
 * Nothing outside this module hashes or encrypts an email.
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto';

export class InvalidEmailError extends Error {
  constructor() {
    super('Invalid email address');
    this.name = 'InvalidEmailError';
  }
}

/**
 * Deliberately loose. The only authority on whether an address exists is whether mail sent to it
 * arrives, which is what the verification link measures — a stricter pattern here would reject
 * valid addresses while proving nothing about the ones it lets through.
 */
const SHAPE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

/**
 * Lowercased and trimmed, and nothing else.
 *
 * Gmail treats dots and `+tags` as noise, but most providers do not, and stripping them would
 * merge two addresses that belong to different people on any host that disagrees. Normalising
 * only what every provider agrees on is the difference between a canonical form and a guess.
 */
export function normalizeEmail(raw: unknown): string {
  if (typeof raw !== 'string') throw new InvalidEmailError();
  const value = raw.trim().toLowerCase();
  if (value.length < 3 || value.length > 254 || !SHAPE.test(value)) throw new InvalidEmailError();
  return value;
}

function pepper(): string {
  const value = process.env.EMAIL_HMAC_PEPPER;
  if (!value || value.length < 32) {
    throw new Error('EMAIL_HMAC_PEPPER is missing or too short (want 32+ chars)');
  }
  return value;
}

function encryptionKey(): Buffer {
  const value = process.env.EMAIL_ENCRYPTION_KEY;
  if (!value) throw new Error('EMAIL_ENCRYPTION_KEY is not set');
  const key = Buffer.from(value, 'base64url');
  if (key.length !== 32) throw new Error('EMAIL_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

/**
 * The lookup key. Peppered rather than salted, for the same reason phone numbers are: recovery
 * starts from an address and no idea which row owns it, so a per-row salt would make finding it
 * a scan instead of an index probe.
 */
export function hashEmail(raw: string): string {
  return createHmac('sha256', pepper()).update(normalizeEmail(raw)).digest('hex');
}

/**
 * AES-256-GCM, with the nonce and tag carried alongside the ciphertext.
 *
 * GCM rather than CBC because the tag makes tampering a decryption failure rather than a
 * silently different address — and an address this system will send a "confirm your account is
 * being taken over" link to is exactly the kind of value worth refusing to guess at.
 */
export function encryptEmail(raw: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(normalizeEmail(raw), 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptEmail(stored: string): string {
  const [ivPart, tagPart, dataPart] = stored.split('.');
  if (!ivPart || !tagPart || !dataPart) throw new Error('Malformed stored email');

  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
}

/** Shown to the owner as confirmation without reprinting the whole address on screen. */
export function maskEmail(raw: string): string {
  const [local, domain] = normalizeEmail(raw).split('@');
  const head = local.slice(0, 1);
  const tail = local.length > 2 ? local.slice(-1) : '';
  return `${head}${'•'.repeat(Math.max(1, local.length - 2))}${tail}@${domain}`;
}

/**
 * A verification or cancellation token, and the hash stored in its place.
 *
 * 32 bytes of randomness, because this token alone changes what an account's recovery address
 * is — it deserves the same treatment as a session, not the six digits an OTP gets away with on
 * the strength of a three-attempt cap.
 */
export function createEmailToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHmac('sha256', pepper()).update(token).digest('hex');
}

/** Constant-time, so a near-miss token cannot be walked into a hit one character at a time. */
export function tokenMatches(token: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashToken(token), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

/** How long a verification link stays usable. */
export const EMAIL_TOKEN_TTL_MS = 60 * 60 * 1000;

export function emailTokenExpiresAt(nowMs: number = Date.now()): Date {
  return new Date(nowMs + EMAIL_TOKEN_TTL_MS);
}

/**
 * Inviting a guardian who does not use Saku.
 *
 * Two jobs, both of which exist because such a guardian has no account and
 * therefore no session: the number has to be storable and later contactable,
 * and the link sent to them has to stand in for a login.
 *
 * Nothing outside this module encrypts or decrypts a guardian's number.
 *
 * The token helpers are deliberately thin wrappers over `lib/email.ts`. A
 * second token scheme is a second place to get constant-time comparison, token
 * length, or hashing wrong, and the weaker of two schemes is the one an
 * attacker uses. These share one implementation and differ only in name.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

import { createEmailToken, hashToken, tokenMatches } from '@/lib/email';
import { hashPhone, normalizePhone } from '@/lib/phone';

/**
 * The same key the backup email uses.
 *
 * One key for "contact details we must be able to read back" rather than one
 * per field: rotating two keys in step is harder than rotating one, and a
 * deployment that sets only half of them fails in a way nobody notices until a
 * recovery needs the half that is missing.
 */
function encryptionKey(): Buffer {
  const value = process.env.EMAIL_ENCRYPTION_KEY;
  if (!value) throw new Error('EMAIL_ENCRYPTION_KEY is not set');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('EMAIL_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

/**
 * AES-256-GCM, nonce and tag carried alongside the ciphertext.
 *
 * GCM rather than CBC because the tag turns tampering into a decryption failure
 * rather than a silently different number — and this number receives a message
 * saying someone is recovering an account, so guessing at it is worse than
 * refusing.
 *
 * Stored normalised, so the value that comes back out is already in the form
 * the WhatsApp gateway expects.
 */
export function encryptPhone(raw: string, country = '62'): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(normalizePhone(raw, country), 'utf8'),
    cipher.final(),
  ]);
  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptPhone(stored: string): string {
  const [ivPart, tagPart, dataPart] = stored.split('.');
  if (!ivPart || !tagPart || !dataPart) throw new Error('Malformed stored phone');

  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Both halves of an invited number, in the pair the row's check constraint demands. */
export function inviteFields(raw: string, country = '62'): {
  invite_phone_hash: string;
  invite_phone_ciphertext: string;
} {
  return {
    invite_phone_hash: hashPhone(raw, country),
    invite_phone_ciphertext: encryptPhone(raw, country),
  };
}

/**
 * A link token, and the hash stored in its place.
 *
 * 32 bytes, like the email tokens, because this token is the whole credential —
 * there is no session behind it and no attempt counter in front of it, so it
 * has to be infeasible to guess rather than merely tedious.
 */
export function createGuardianToken(): { token: string; hash: string } {
  return createEmailToken();
}

export { hashToken as hashGuardianToken, tokenMatches as guardianTokenMatches };

/**
 * How long an invitation link stays usable.
 *
 * Long, unlike the one-hour email links, because the two are read under
 * different conditions. An account owner clicking "send me a link" is sitting
 * at their inbox; an invited guardian is someone else entirely, who got a
 * WhatsApp message out of nowhere and may well want to phone the sender before
 * agreeing to anything. A link that dies overnight turns that caution into a
 * dead end and a second invitation.
 */
export const GUARDIAN_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function guardianInviteExpiresAt(nowMs: number = Date.now()): Date {
  return new Date(nowMs + GUARDIAN_INVITE_TTL_MS);
}

/** True once the invitation link has aged out. Mirrors `isOtpExpired`'s shape. */
export function isGuardianInviteExpired(
  invitedAt: Date | string,
  nowMs: number = Date.now()
): boolean {
  const at = invitedAt instanceof Date ? invitedAt : new Date(invitedAt);
  return nowMs - at.getTime() >= GUARDIAN_INVITE_TTL_MS;
}

/**
 * This device's copy of its owner's own phone number.
 *
 * Saku stores the number as an HMAC and nothing else, so the server genuinely cannot show anyone
 * their own number — which is correct for a database breach and absurd from the user's side of
 * the screen, where it is *their* number and they are simply asking what it is.
 *
 * The resolution is the one this codebase already uses for contacts' numbers (`useContacts`) and
 * for recent recipients (`lib/recent-recipients.ts`): the browser keeps the plain value, the
 * server keeps the hash. Verifying an OTP is the one moment a plaintext number exists on the
 * client, so it is the one moment this can be written.
 *
 * Keyed by `scope` — the owner's own `phone_hash` — for the same reason those two are. A bare
 * device-wide key would show the first account's number to the second person who signs in on a
 * shared browser, which is worse than showing nothing. A missing scope means no confirmed
 * identity yet, so reads come back null and writes are dropped rather than falling back to a
 * shared key. `forgetDeviceHistory` clears it on sign-out along with everything else of this
 * kind; the key is listed in `SCOPED_KEYS` there, and changing this string without changing that
 * list would leave the number on the device.
 *
 * What is stored is what the user typed, plus the dialling code they picked. It is deliberately
 * *not* run through `normalizePhone`: that function is the single source of truth for turning a
 * number into an identity, it lives server-side behind a pepper, and a second implementation of
 * its rules is the exact bug its own documentation was written about. Nothing here is ever
 * hashed, compared or sent anywhere — it is a string this device shows back to its owner — so
 * the tidying below is presentation and carries none of that weight.
 */

const OWN_NUMBER_KEY = 'saku_own_number';

export interface OwnNumber {
  /** Dialling code, digits only, no plus. */
  dialCode: string;
  /** National digits as typed, with any leading zero already dropped. */
  national: string;
}

/** Display only. See the note above on why this does not reuse `normalizePhone`. */
function tidy(raw: string, dialCode: string): OwnNumber {
  const code = dialCode.replace(/\D/g, '');
  let digits = raw.replace(/\D/g, '');

  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  else if (code && digits.startsWith(code) && digits.length > code.length) {
    digits = digits.slice(code.length);
  }

  return { dialCode: code, national: digits };
}

/**
 * Remember the number this device just signed in with.
 *
 * Called once, right after verification, when `scope` is finally known — the hash is peppered
 * server-side, so the client cannot compute it and has to wait for `/api/me` to come back.
 */
export function rememberOwnNumber(
  scope: string | null | undefined,
  raw: string,
  dialCode: string
): void {
  if (!scope || !raw) return;
  try {
    localStorage.setItem(`${OWN_NUMBER_KEY}:${scope}`, JSON.stringify(tidy(raw, dialCode)));
  } catch {
    // Non-fatal. The profile screen falls back to the dial-code-and-last-four hint, which is
    // what every other device shows anyway.
  }
}

/** Null on any device that did not sign this account in, which is the normal case elsewhere. */
export function readOwnNumber(scope: string | null | undefined): OwnNumber | null {
  if (!scope) return null;
  try {
    const raw = localStorage.getItem(`${OWN_NUMBER_KEY}:${scope}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OwnNumber;
    return parsed?.national ? parsed : null;
  } catch {
    return null;
  }
}

/** `+62 81234567890`, the shape it was entered in rather than a reformatting of it. */
export function formatOwnNumber(value: OwnNumber): string {
  return `+${value.dialCode} ${value.national}`;
}

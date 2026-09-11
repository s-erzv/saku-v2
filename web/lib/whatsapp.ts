/**
 * The WhatsApp gateway, in one place.
 *
 * Extracted from `app/api/request-otp/route.ts`, which owned it privately until
 * guardian invitations needed to reach a phone number too. A second copy of
 * this would be a second place to get the target-rewrite defence and the
 * queued-target check wrong, and the copy that was got wrong is the one that
 * silently delivers to nobody.
 *
 * Every send reports an outcome rather than throwing. A caller decides whether
 * a failed message is worth failing the request over — for an OTP it is, for a
 * courtesy notice to a guardian it is not.
 */

export type SendOutcome = 'sent' | 'not-on-whatsapp' | 'failed';

/**
 * Turns off the gateway's own number rewriting.
 *
 * Fonnte defaults this to `62` and then "adds the country code if it does not
 * exist" — where "exist" means the target already starts with that exact
 * prefix. Saku normalizes every number to full international digits before it
 * gets here, so for an Indonesian number the default was a no-op and nobody
 * noticed. For everyone else it silently mangled the target: a Malaysian
 * `60811111111` was rewritten to `6260811111111` and queued against a number
 * that does not exist. The send still reported success, so the user was told
 * the message was on its way and nothing ever arrived. `'0'` disables the
 * rewrite and sends the digits exactly as given.
 */
const NO_GATEWAY_REWRITE = '0';

function gatewayToken(): string | null {
  return process.env.FONNTE_TOKEN?.trim() || null;
}

/**
 * Hand a message to the gateway. This and `lib/otp-test-numbers.ts` are the
 * only places in Saku that touch a plain phone number, and neither persists it.
 *
 * @param label Prefixes the log lines, so a failure says which feature it broke.
 */
export async function sendWhatsApp(
  normalizedPhone: string,
  message: string,
  label = 'wa'
): Promise<SendOutcome> {
  const token = gatewayToken();
  if (!token) {
    console.error(`[${label}] FONNTE_TOKEN is not set`);
    return 'failed';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: token, Accept: 'application/json' },
      body: new URLSearchParams({
        target: normalizedPhone,
        countryCode: NO_GATEWAY_REWRITE,
        message,
      }),
    });

    if (!response.ok) {
      console.error(`[${label}] gateway HTTP`, response.status);
      return 'failed';
    }

    const result = await response.json();

    // The gateway echoes back the number it actually queued. If that is not the
    // number we asked for, the message is on its way to a stranger or to
    // nowhere, and reporting success would leave someone waiting for a message
    // that cannot arrive.
    const queued: unknown = result?.target;
    if (result?.status && Array.isArray(queued) && !queued.includes(normalizedPhone)) {
      console.error(`[${label}] gateway rewrote the target:`, JSON.stringify(queued).slice(0, 200));
      return 'failed';
    }

    if (result?.status) return 'sent';

    // The gateway explains itself and this used to be thrown away, leaving every
    // failure — a number with no WhatsApp, an exhausted quota, a disconnected
    // device — as the same silent "something went wrong".
    console.error(`[${label}] gateway refused:`, JSON.stringify(result).slice(0, 300));
    return (await isOnWhatsApp(normalizedPhone)) === false ? 'not-on-whatsapp' : 'failed';
  } catch (error) {
    console.error(`[${label}] gateway unreachable:`, error);
    return 'failed';
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Does this number have a WhatsApp account? Asked only to explain a send that already failed,
 * never to decide whether one may go out — the difference matters more than it looks.
 *
 * Gating every login on this answer was tried and reverted. Two reasons. A wrong `not_registered`
 * would lock a real user out of the app permanently, which is a far worse failure than a code
 * that has to be requested twice; and a contact-existence probe on every sign-in is exactly the
 * traffic pattern that gets an unofficial WhatsApp gateway's number banned, which would take
 * every user down at once. A number that truly has no WhatsApp is rare in a wallet people sign
 * up for with their own phone, and the mangled-target bug that looked like this problem is now
 * caught directly, by comparing what the gateway queued against what we asked it to send.
 *
 * Returns null when the check itself could not be completed — "we do not know" and "the number
 * has no WhatsApp" must not collapse into the same answer, or a gateway outage would start
 * telling people their own number does not exist.
 */
export async function isOnWhatsApp(normalizedPhone: string): Promise<boolean | null> {
  const token = gatewayToken();
  if (!token) return null;

  try {
    const response = await fetch('https://api.fonnte.com/validate', {
      method: 'POST',
      headers: { Authorization: token, Accept: 'application/json' },
      body: new URLSearchParams({
        target: normalizedPhone,
        countryCode: NO_GATEWAY_REWRITE,
      }),
    });
    if (!response.ok) return null;

    const result = (await response.json()) as {
      status?: boolean;
      registered?: string[];
      not_registered?: string[];
    };
    if (!result?.status) return null;

    if (result.registered?.includes(normalizedPhone)) return true;
    if (result.not_registered?.includes(normalizedPhone)) return false;
    return null;
  } catch {
    return null;
  }
}

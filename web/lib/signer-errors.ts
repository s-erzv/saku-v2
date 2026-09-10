/**
 * Failures that any remote signing provider can produce, named for what they mean to a caller
 * rather than for whose API returned them.
 *
 * These live apart from the provider modules because the provider is a thing this app has now
 * changed once already and could change again. `/api/mpc/sign` decides what to tell
 * the user; it should not have to know which vendor is behind the signature to do that.
 */

/** The provider could not be reached at all — DNS, TCP, TLS, or a dropped socket. Retryable. */
export class SignerUnreachableError extends Error {
  constructor() {
    super('Could not reach the signing service');
    this.name = 'SignerUnreachableError';
  }
}

/**
 * The provider refuses to sign because the account is over its plan quota.
 *
 * Nothing about the request is wrong and retrying will not help — this is the operator's problem,
 * not the user's, and saying so is more useful than a generic failure.
 */
export class SignerQuotaError extends Error {
  constructor() {
    super('Signing quota exhausted');
    this.name = 'SignerQuotaError';
  }
}

/**
 * Whether a failure happened before the provider could act on the request.
 *
 * Only connection-level failures qualify. An HTTP error means the request arrived and was
 * answered; retrying that would be asking a second time for something already refused.
 */
export function isConnectionFailure(error: unknown): boolean {
  const codes = [
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
    'ECONNRESET',
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
  ];
  for (let cause: unknown = error, depth = 0; cause && depth < 5; depth += 1) {
    const e = cause as { code?: string; message?: string; cause?: unknown };
    if (e.code && codes.includes(e.code)) return true;
    if (e.message === 'fetch failed') return true;
    cause = e.cause;
  }
  return false;
}

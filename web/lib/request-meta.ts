/**
 * Who a request claims to be from, and how much of that claim is worth anything.
 *
 * Replaces `lib/auth-middleware.ts`, which carried a bearer-token `validateAuth`/`withAuth` pair
 * that nothing imported any more. Deleting it rather than leaving it in place is deliberate:
 * sessions are httpOnly cookies now (`lib/session.ts`), and a working, exported helper for the
 * transport we just moved off is an invitation to put a route back on it by accident.
 */

/**
 * Best available client IP.
 *
 * The previous version read `x-forwarded-for` and took the **first** entry. That entry is the one
 * the client sent; proxies append, they do not replace. So every IP-keyed rate limit in the app
 * was keyed on a value the caller could set to anything, and rotating a header was enough to have
 * a fresh limit on every request.
 *
 * The order below is: headers the hosting platform sets itself and strips from client input
 * first, then the **rightmost** `x-forwarded-for` entry — the one appended by the proxy closest to
 * us, which is the last hop the client could not write.
 *
 * Returns null rather than a placeholder when nothing is trustworthy. Callers must decide what
 * that means for them; bucketing every unidentifiable request under one shared key would let one
 * caller exhaust the limit for everybody.
 */
export function extractClientIP(req: Request): string | null {
  const headers = req.headers;

  // Set by the platform edge, not by the client. Vercel and Netlify both overwrite these on the
  // way in, so a client-supplied copy never survives to here.
  const platform =
    headers.get('x-vercel-forwarded-for') ||
    headers.get('x-nf-client-connection-ip') ||
    headers.get('cf-connecting-ip') ||
    headers.get('true-client-ip');
  if (platform) return normalise(platform.split(',')[0]);

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean);
    // Rightmost, not leftmost: everything to the left of the last hop is client-writable.
    if (hops.length > 0) return normalise(hops[hops.length - 1]);
  }

  const real = headers.get('x-real-ip');
  return real ? normalise(real) : null;
}

/** Strip an IPv6 zone or a port so the same client always produces the same bucket key. */
function normalise(value: string): string | null {
  const trimmed = value.trim().replace(/^\[|\]$/g, '');
  if (!trimmed) return null;
  // `1.2.3.4:5678` — a port makes each connection its own rate-limit bucket.
  const withoutPort = /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(trimmed)
    ? trimmed.slice(0, trimmed.lastIndexOf(':'))
    : trimmed;
  return withoutPort.slice(0, 64);
}

/**
 * Rate-limit key for a caller with no session.
 *
 * When the IP cannot be trusted, this deliberately returns a key that is *shared* by every such
 * caller. That is strictly the safe direction: unidentifiable traffic competes for one small
 * budget instead of each request minting a fresh, empty limit for itself.
 */
export function clientKey(req: Request, prefix: string): string {
  return `${prefix}:${extractClientIP(req) ?? 'unattributed'}`;
}

export function extractUserAgent(req: Request): string | null {
  return req.headers.get('user-agent') || null;
}

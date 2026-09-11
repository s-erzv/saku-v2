/**
 * The public origin of this deployment, for links that leave the app.
 *
 * A verification link is read in a mail client, on a device that has never talked to this
 * server, possibly days later. It cannot be relative and it cannot be wrong, which makes this
 * the one place in the app where guessing the host actually costs something: a link built from
 * `localhost` is dead on arrival, and one built from a preview deployment's hostname points a
 * production user at a build that may no longer exist.
 *
 * Three sources, in order of how much they can be trusted:
 *
 *  1. `NEXT_PUBLIC_APP_URL`. Set deliberately, so it is right by construction. Preferred.
 *  2. The forwarded headers. Every proxy in front of this app rewrites them, which is exactly
 *     why `request.url` alone is not enough — a route handler behind a proxy often sees an
 *     internal address, and on Vercel it can see `http` for a site only reachable over `https`.
 *  3. `request.url`. Correct when nothing is in front of the app, which is the dev case.
 *
 * Headers are attacker-controlled in principle, so this is only ever used to build a link sent
 * to an address the request itself named — never to decide what a token is allowed to do.
 */
export function appOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  const forwardedHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (forwardedHost) {
    // A forwarded proto is authoritative when present. Without one, anything that is not
    // obviously local is assumed to be served over TLS, because in 2026 it is.
    const proto =
      request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ??
      (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(forwardedHost) ? 'http' : 'https');
    return `${proto}://${forwardedHost}`;
  }

  // Vercel exposes the stable production hostname even when nothing else is available.
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelHost) return `https://${vercelHost}`;

  return new URL(request.url).origin;
}

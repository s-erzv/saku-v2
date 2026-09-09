/**
 * Security headers for every request.
 *
 * The Content-Security-Policy here used to be a policy in name only. `script-src` carried
 * `'unsafe-eval'`, so injected code could compile more of itself; `connect-src` allowed `https:`,
 * so anything running on the page could post what it found to any host on the internet. The
 * second of those is the half that turns a script injection into a breach, and it is closed now:
 * the browser may open a connection to this origin and to the chain's RPC endpoint. Nowhere else.
 *
 * **On nonces, and why there isn't one.** The obvious next step is a per-request nonce with
 * `'strict-dynamic'`, which would stop an injected `<script>` outright. It was written, deployed
 * to a local production build, and reverted, because it silently broke the app: a nonce reaches
 * Next through a request header, and a statically prerendered page is rendered at build time
 * where no request exists. Most of Saku's routes prerender, so their inline bootstrap scripts
 * came back with no nonce — and a browser that sees a nonce ignores `'unsafe-inline'` completely,
 * so every one of them would have been blocked and the app would have loaded blank.
 *
 * Making it work means `export const dynamic = 'force-dynamic'` on every route, giving up static
 * rendering app-wide. That is a real trade with a real hosting cost, and it is the owner's call
 * rather than something to slip in under a security change. Until then this policy does what it
 * can honestly claim: only same-origin scripts load, nothing can `eval`, and nothing can phone
 * home.
 *
 * There was a second, looser copy of this policy in `next.config.ts`. Two policies on one response
 * are enforced as their intersection, which is not wrong so much as impossible to reason about —
 * it has been removed, and this is now the only place a CSP is set.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** Everything the browser is allowed to open a connection to. */
function connectSources(): string[] {
  const sources = ["'self'"];

  // Balances, staking figures and allowances are read straight from the chain in the browser
  // (`hooks/useTokenBalances.ts`, `useStaking.ts`, `useWarmApproval.ts`), so the RPC endpoint has
  // to be reachable. Only that endpoint — the old `https:` wildcard let an injected script
  // exfiltrate to anywhere, which is the half of an XSS that turns it into a breach.
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
  if (rpcUrl) {
    try {
      sources.push(new URL(rpcUrl).origin);
    } catch {
      // A malformed RPC URL is a configuration problem, not a reason to widen the policy.
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    // Turbopack's HMR socket and whatever port `next dev` landed on.
    sources.push('http://localhost:*', 'ws://localhost:*', 'wss://localhost:*');
  }

  return sources;
}

function buildCsp(): string {
  const isDev = process.env.NODE_ENV !== 'production';

  const scriptSrc = [
    // Same-origin only: an injected `<script src="https://…">` does not load, whoever put it
    // there. Inline injection is not covered — see the note at the top of this file for what it
    // would take, and `lib/tx-policy.ts` for what stands behind CSP when it is not enough.
    "'self'",
    "'unsafe-inline'",
    // React Refresh compiles components at runtime. Never sent in production, where an injected
    // script being able to call `eval` is most of what makes one dangerous.
    ...(isDev ? ["'unsafe-eval'"] : []),
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    // Tailwind and React both emit inline styles. A style injection can reskin a page and, with
    // effort, exfiltrate a little through selectors; it cannot execute. Nonce-ing every style
    // Next emits is not something the framework supports today, so this stays.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
    // Avatars live in a Supabase storage bucket and receipts are rendered to blobs. Images cannot
    // execute, so this is the one place a wildcard costs little.
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob:",
    `connect-src ${connectSources().join(' ')}`,
    // The service worker in public/sw.js is same-origin. Stated explicitly because a CSP that
    // blocks a worker fails silently — no console error, no registration, nothing to debug.
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    // No third party is ever framed, and Saku is never framed by anyone: `frame-ancestors` is the
    // header that actually stops clickjacking, `X-Frame-Options` being its legacy half.
    "frame-src 'none'",
    "frame-ancestors 'none'",
    // Nothing on this site posts a form anywhere else. A phishing overlay that harvests a
    // verification code has to send it somewhere, and this closes the simplest route.
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(process.env.NODE_ENV === 'production' ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  response.headers.set('Content-Security-Policy', buildCsp());
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'
  );
  // Keeps this origin out of other sites' browsing-context groups, so a page that opens Saku
  // cannot reach into it via `window.opener` or measure it through a shared process.
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');

  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the image optimiser. Those are served straight from
     * disk, carry no session, and gain nothing from a policy about what scripts may run.
     */
    '/((?!_next/static|_next/image|favicon.ico|icons/|sw.js|manifest.json).*)',
  ],
};

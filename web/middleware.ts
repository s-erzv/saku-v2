/**
 * Next.js Middleware
 * Adds security headers to all API routes
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Security Headers
  // Prevent MIME type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking
  response.headers.set('X-Frame-Options', 'DENY');

  // Enable XSS protection (legacy browsers)
  response.headers.set('X-XSS-Protection', '1; mode=block');

  // Enforce HTTPS (only in production)
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Content Security Policy (basic version)
  // You may want to customize this based on your app's needs
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; " +
    // No payment SDK is loaded: Xendit checkout is a full-page redirect to their own domain,
    // so it needs nothing here — no third-party script, no iframe, no relaxed frame-src.
    // Signing happens server-side against Turnkey now (see docs/mpc-setup.md), so this no
    // longer needs the wasm-unsafe-eval/blob-worker allowances a client-side MPC library once
    // required.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com; " +
    // flag-icons for the country-code picker on the login screen.
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
    // The service worker (public/sw.js) is same-origin, so `default-src 'self'` already covers
    // it — stated explicitly anyway because a CSP blocking a worker fails silently, with no
    // console error and no registration, which is a miserable thing to debug from scratch.
    "worker-src 'self'; " +
    "manifest-src 'self'; " +
    "img-src 'self' data: blob: https:; " +
    "font-src 'self' data: https://cdn.jsdelivr.net; " +
    "connect-src 'self' " +
      "https: " +  // Allow all HTTPS connections (for development - tighten for production!)
      "http://localhost:* " +  // Allow localhost for development
      "ws://localhost:* wss://localhost:*; " +  // Allow WebSocket for development
    "frame-ancestors 'none';"
  );

  // Referrer Policy
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions Policy (restrict browser features)
  response.headers.set(
    'Permissions-Policy',
    'camera=(self), microphone=(), geolocation=(), interest-cohort=()'
  );

  return response;
}

export const config = {
  matcher: [
    // Apply to all API routes
    '/api/:path*',
    // Apply to all pages
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Content-Security-Policy that used to live here has moved to `middleware.ts`, which can
  // mint a per-request nonce. Two CSP headers on one response are enforced as their intersection,
  // which made the effective policy something neither file stated on its own.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Content-Security-Policy that used to live here has moved to `middleware.ts`, which can
  // mint a per-request nonce. Two CSP headers on one response are enforced as their intersection,
  // which made the effective policy something neither file stated on its own.
  // No `images.remotePatterns` here, deliberately.
  //
  // It used to allow `https://**` — any host on the internet. That turns `/_next/image` into an
  // unauthenticated fetch-and-decode of attacker-chosen bytes, which is the precondition for the
  // AVIF remote-code-execution advisory against Next 16.0.x. The upgrade in `package.json` is the
  // fix; removing this is what makes the endpoint uninteresting even if another decoder bug turns
  // up later.
  //
  // Nothing needed it. `next/image` appears in exactly one component, the onboarding slider, and
  // it points at assets in `public/`. Avatars are rendered with plain `<img>`, which never goes
  // through the optimiser. Re-adding this means naming the specific host, never a wildcard.
};

export default nextConfig;

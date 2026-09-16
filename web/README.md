<p align="center">
  <img src="public/logo.png" alt="Saku" width="160" />
</p>

<h1 align="center">Saku — app</h1>

<p align="center">The Next.js application: every screen, every API route, and all off-chain logic.</p>

---

Project-wide context lives in the [repository root README](../README.md): the custody statement,
the full environment variable list, the deployed contract addresses, and how the two projects fit
together. This file covers what is inside `web/` and how it is organised.

> **Custody.** Saku is not a non-custodial wallet. The server can produce a signature for any
> user's wallet. What bounds that is `lib/tx-policy.ts`, `lib/spend-limits.ts` and
> `signing_events`, not anything a user holds. See "Custody, stated first" in the root README
> before changing anything under `app/api/mpc/`.

## Running

```bash
pnpm install
# create .env.local by hand; the root README lists every variable
pnpm dev                    # http://localhost:3000
```

```bash
pnpm test                   # unit tests over lib/
pnpm run verify:tx-policy   # asserts the signing policy still refuses what it should
pnpm lint
pnpm build
```

`verify:tx-policy` is the one to run before any change near signing. It checks that the policy
still rejects unknown contracts, foreign chains, native value and arbitrary spender approvals.

## Screens

| Route | What it is |
|---|---|
| `/` | Landing page. The only screen designed for a desktop viewport. |
| `/get-started`, `/onboarding` | Phone sign-in and the first-run tour |
| `/home` | The dashboard: balance, services, activity |
| `/transfer` | Send to a phone number |
| `/topup`, `/topup/callback/[orderId]` | Buy in with fiat via Xendit |
| `/offramp` | Cash out to a bank or e-wallet, through the escrow |
| `/pay`, `/pay/[code]`, `/pay/qris` | QR payments, including QRIS parsing |
| `/packet`, `/packet/create`, `/packet/claim/[code]` | Gift packets |
| `/split-bill`, `/split-bill/[id]` | Shared costs |
| `/staking` | Stake USDC, earn USDC |
| `/transactions`, `/notifications`, `/profile` | History, alerts, settings |
| `/security/setup`, `/profile/security`, `/recover` | Backup email, guardians, account recovery |
| `/guardian/invite/[token]`, `/guardian/approve/[token]` | Guardian flows, reachable without an account |

Everything except `/` is built for a phone and capped at `max-w-lg`. Sizes are written as
`clamp(floor, N vw, desktop)` rather than `sm:` pairs, so one design is drawn at whatever size
the column happens to be instead of two designs swapping over at 640px. The reasoning is written
out at the top of `components/home/quick-actions.tsx`.

## The important modules

Signing and money:

| File | Responsibility |
|---|---|
| `lib/tx-policy.ts` | What shape of transaction Saku will sign at all. A closed set. |
| `lib/spend-limits.ts` | Rolling 24 hour cap, and the `signing_events` record of every decision |
| `lib/privy.ts` | The custodian. Provisions wallets and signs; never broadcasts. |
| `lib/chain.ts` | Server-side chain access for the settler. Never runs in the browser. |
| `lib/gas.ts` | The tBNB drip that lets a new wallet transact at all |
| `lib/escrow.ts`, `lib/offramp-payout.ts`, `lib/offramp-sweep.ts` | The off-ramp lock, settle and expiry-refund legs |

Identity and access:

| File | Responsibility |
|---|---|
| `lib/session.ts` | httpOnly session cookie, plus the same-origin check behind `SameSite=Lax` |
| `lib/phone.ts`, `lib/phone-identity.ts` | Peppered phone hashing, and reading rows written under the older unkeyed rule |
| `lib/otp.ts`, `lib/whatsapp.ts` | OTP issue and delivery via Fonnte |
| `lib/recovery.ts`, `lib/guardians.ts`, `lib/guardian-invite.ts` | The rules a recovery must satisfy before an account changes hands |
| `lib/email.ts`, `lib/mailer.ts` | Tokens and SMTP for the backup-email leg |

`hooks/useMpcWallet.tsx` is the client side of signing. It exposes an ethers signer that holds no
key material and no bearer token: it posts the unsigned transaction to `/api/mpc/sign` and the
cookie travels on its own.

## Conventions worth knowing before editing

- **Comments carry the reasoning, not the mechanics.** Most modules open with a block explaining
  why the current shape was chosen and what earlier shapes failed. Several of those exist
  specifically to stop a fix being reverted. Read the block before rewriting the file.
- **Server-only modules guard themselves.** `lib/chain.ts` and `lib/supabaseAdmin.ts` throw if
  they are ever evaluated in the browser.
- **Refusals are logged as loudly as approvals.** A burst of policy refusals is the signal worth
  having, so do not quietly swallow one.
- **Nothing broadcasts server-side.** The client gets a signature back and sends it. Keeping it
  that way is what makes `/api/mpc/sign` safe to retry.

## Stack

Next.js 16 on React 19, TypeScript, Tailwind v4, Radix primitives, Lucide icons, Framer Motion.
Supabase for Postgres, ethers 6 for chain access, Privy for custody. Web push over VAPID, Xendit
for fiat rails, Gemini for reading QRIS codes and receipts. Also packaged as a Farcaster mini app.

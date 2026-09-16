<p align="center">
  <img src="web/public/logo.png" alt="Saku" width="160" />
</p>

<h1 align="center">Saku</h1>

<p align="center">A wallet you use with a phone number, on BNB Smart Chain.</p>

---

Saku is a payments app for people who do not want to think about wallets. You sign in with a
phone number, money arrives at a phone number, and nothing on screen asks you to copy a 42
character address. Underneath it is a normal EVM account on BSC Testnet holding a demo USDC,
with an on-chain escrow for cashing out to a bank or e-wallet.

This repository holds two projects that ship together but build separately.

## Custody, stated first

**Saku is not a non-custodial wallet, and the product copy says so.**

User keys live with a signing provider and never exist inside this application or its database.
The *authority* to use them lives on Saku's server, which means the server can produce a
signature for any user's wallet whenever it decides to. Calling that non-custodial because the
bytes sit elsewhere would be a distinction that matters to nobody whose money it is.

What bounds that authority is code in this repo rather than anything a user holds:

| Guard | Lives in | What it refuses |
|---|---|---|
| Transaction policy | `web/lib/tx-policy.ts` | Anything outside the handful of calls Saku actually makes. No unknown contracts, no other chains, no native value, no arbitrary spender approvals. |
| Daily cap | `web/lib/spend-limits.ts` | Signing past a per-user daily total. |
| Audit trail | `web/lib/spend-limits.ts` | Nothing, but every signing decision lands in `signing_events`. `web/lib/audit-log.ts` covers the rest of the app and deliberately not this. |
| Session | `web/lib/session.ts` | A session token readable by page script. |

The escrow contract is the one place where on-chain rules do that job instead: a locked request
can be moved only by the settler role, only before its deadline, and only by swapping into the
configured stable token. After the deadline anyone can refund it to the user.

## Layout

```
saku/
├── web/         Next.js app, API routes, and all off-chain logic
├── contract/    Solidity, Hardhat + Foundry, BSC Testnet deployments
└── docs/        Working notes. Git-ignored on purpose; see below.
```

The two projects do not share a lockfile. `web` uses pnpm, `contract` uses npm. There is no root
package manifest and nothing to install at the top level.

`.gitignore` keeps `docs/` out of the repository deliberately, with `README.md` as the one
exception. The reasoning is in the file itself: notes go stale faster than the code they
describe, and a wrong doc in a repository is read as true long after it stopped being true.
So durable documentation belongs in a README next to what it documents, and nowhere else.

## Running it

Node 20.9 or newer, because Next.js 16 requires it.

```bash
# The app
cd web
pnpm install
# create .env.local by hand; see Environment below
pnpm dev                           # http://localhost:3000

# The contracts
cd contract
npm install
npm run compile
npm test
```

There is no committed env example, so the list below was read out of the source rather than out
of a template that may have drifted.

## Environment

Everything is required unless marked optional. Nothing here has a safe default.

**Core**

| Name | Notes |
|---|---|
| `JWT_SECRET` | Signs the session. |
| `NEXT_PUBLIC_APP_URL` | The public origin. Optional, but set it: it is the only source `web/lib/app-url.ts` trusts by construction when building links that leave the app, such as recovery emails. |

**Supabase**

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

The schema is not tracked in this repository. It lives in the Supabase project.

**Chain**

| Name | Notes |
|---|---|
| `NEXT_PUBLIC_CHAIN_ID` | Defaults to `97`, BSC Testnet. |
| `NEXT_PUBLIC_RPC_URL` | Falls back to a public BSC Testnet node. |
| `NEXT_PUBLIC_BLOCK_EXPLORER` | Used for receipt links. |
| `NEXT_PUBLIC_MOCK_USDC_ADDRESS`, `NEXT_PUBLIC_STABLE_TOKEN_ADDRESS`, `NEXT_PUBLIC_ESCROW_ADDRESS`, `NEXT_PUBLIC_STAKING_ADDRESS` | See the deployed addresses below. |
| `SETTLER_PRIVATE_KEY` | The one private key Saku itself holds. It is the demo token issuer and the escrow's authorized settler. It cannot touch a user's wallet. |

**Custody**

`PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`, `PRIVY_AUTHORIZATION_KEY_ID`,
and `SAKU_DAILY_SIGN_CAP_USDC`.

Two things authorize a signature and both are needed: the app secret authenticates the app, and
the authorization key, a P-256 private key held only here, signs each wallet request. A leaked
app secret on its own moves no money. The dashboard hands the authorization key out with a
`wallet-auth:` prefix, which is a label rather than part of the key; the code strips it, so the
variable can be pasted exactly as copied.

**Phone identity and OTP**

`FONNTE_TOKEN` for WhatsApp delivery, plus `OTP_HMAC_PEPPER` and `PHONE_HMAC_PEPPER`.

**Email and recovery**

`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`,
`EMAIL_ENCRYPTION_KEY`, `EMAIL_HMAC_PEPPER`.

`EMAIL_ENCRYPTION_KEY` must decode from base64 to exactly 32 bytes. It is the single key for
contact details that have to be readable back, covering both backup emails and guardian phone
numbers. One key rather than two, because rotating two in step is harder than rotating one, and
a deployment that sets only half of them fails in a way nobody notices until a recovery needs
the missing half.

**Fiat rails**

`XENDIT_SECRET_KEY`, `XENDIT_WEBHOOK_TOKEN`, `XENDIT_PRESENTMENT_CURRENCIES`, and
`OFFRAMP_SWEEP_TOKEN`, which authorizes the scheduled job that refunds expired off-ramp locks.

**Push and misc**

`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` for web push.
`GEMINI_API_KEY` for reading QRIS codes and receipts.
`VERCEL_ENV` and `VERCEL_PROJECT_PRODUCTION_URL` are read as optional fallbacks only.

## Deployed contracts

BSC Testnet, chain id 97, redeployed 2026-09-11. Full record in
[`contract/deployments/bscTestnet.json`](contract/deployments/bscTestnet.json).

| Contract | Address |
|---|---|
| `SakuOfframpEscrow` | `0xb69108b86a479Ff2B46cc8B80c9B32168C8c3a6c` |
| `SakuStaking` | `0x7B4Fc2362526AF69655D0C1B41bAD5957a76D9fa` |
| `MockUSDC` (6 decimals) | `0x3d2937A6cDb76a1B199b87302D112D584795d3b1` |
| `MockStableToken` (mBUSD) | `0xD12196E766F86F6Fc352d5CECe7637bCd9026a83` |

Two superseded deployments still hold funds and are listed in that file with what is stuck in
each. Read it before assuming a balance is missing.

## Tests

```bash
cd web      && pnpm test                 # unit tests over lib/
cd web      && pnpm run verify:tx-policy # asserts the signing policy still refuses what it should
cd contract && npm test                  # Hardhat suite, including PancakeSwap and Chainlink doubles
```

`verify:tx-policy` is worth running before any change near signing. It is the check that the
policy still rejects unknown contracts, foreign chains, native value and arbitrary approvals.

## Stack

Next.js 16 on React 19, Tailwind v4, ethers 6, Supabase, and Privy for custody. The app is also
packaged as a Farcaster mini app. Contracts build under both Hardhat and Foundry.

## Documentation

The custody section above is the canonical short statement. `web/README.md` covers the app's
screens, module map and editing conventions; `contract/README.md` covers the escrow flow and the
deployment record.

A longer trust-model write-up lives in `ARCHITECTURE.md` at this level, which is deliberately
git-ignored and therefore local only. Nothing committed links to it, so a fresh clone is never
left pointing at a file it does not have.

# Turnkey key management setup (PRD Fase 4, revised)

How Saku v2 signs transactions, why it moved off Web3Auth MPC, and the exact Turnkey
configuration it depends on.

## Why this changed

The original design (still described in git history as "Web3Auth MPC setup") split each user's
signing key into threshold shares — one on-device, one released by Web3Auth's node network
against a verified id token, and an optional recovery share. Two of three were needed to sign,
so Saku's server holding none of them is what made it non-custodial: a full server compromise
yielded sessions, not funds.

That design's real-world signing infrastructure — Web3Auth's `sapphire_devnet` TSS node
network — turned out not to work. Live-browser testing (documented in the project's incident
notes, not guessed at) showed real signatures hanging indefinitely: the client's requests to all
5 TSS nodes returned 200, but no signature ever completed and no error ever surfaced. This
reproduced consistently across sessions, survived several ruled-out hypotheses (a
click-timing race, missing `crossOriginIsolated`/`SharedArrayBuffer`, the project not having
"MPC Core Kit" declared as a dashboard product, a dead JWKS tunnel), and Web3Auth's own status
page showed no incident the whole time. Three separate config fixes were tried and confirmed,
on-chain, not to help. At that point the honest conclusion was that the *infrastructure*, not
Saku's integration of it, was the problem — and continuing to debug someone else's black-box
node network was no longer a good trade against just signing somewhere that works.

## What changed

Signing moved entirely server-side, onto [Turnkey](https://turnkey.com). Every user gets their
own Turnkey **sub-organization** with one Ethereum wallet in it. Saku's backend — not the
browser — asks Turnkey to sign, authenticated with Saku's own API keypair.

| | Web3Auth MPC (previous) | Turnkey (current) |
|---|---|---|
| Where the key lives | Split across device + Web3Auth's network | Inside Turnkey's enclave, never Saku's DB |
| Who can produce a signature | Device share **and** a valid OTP together | A valid Saku session, alone |
| What a server compromise costs | Nothing signable (device share still needed) | The ability to sign while a session exists |
| What actually worked in testing | No | Yes |

This is a real reduction in the non-custodial guarantee, stated plainly rather than glossed
over: Saku's backend, holding a valid session for a phone number, can now always ask Turnkey to
sign for that number's wallet. There is no independent, user-held factor blocking it the way a
device share used to. What Turnkey buys back is that the key material itself is still never in
a form Saku's server (or a leaked database) can extract — a breach yields signing capability
gated by whatever session-issuing logic Saku still controls, not a portable secret. Weighed
against threshold signing that provably did not work, this was the trade worth making. If a
stronger guarantee is wanted later, the documented upgrade path is a client-held passkey as the
sub-organization's quorum instead of Saku's own API key — deliberately not built now, since it
reintroduces real UX work this rewrite was trying to avoid.

## How a wallet comes to exist

1. A user verifies an OTP against `/api/verify-otp`, exactly as before. Saku issues its usual
   HS256 session token, carrying `phoneHash` — never the phone number.
2. The client calls `/api/mpc/provision` with that session token. The server looks up
   `wallets` for an existing Turnkey mapping; if there isn't one, it calls
   `createUserWallet(phoneHash)` (`lib/turnkey.ts`), which does one thing on Turnkey's side:
   creates a sub-organization named after the phone hash, with **Saku's own API keypair
   enrolled as that sub-org's root user**, and one `CURVE_SECP256K1` / `ADDRESS_FORMAT_ETHEREUM`
   wallet inside it.
3. The address, sub-organization id, and wallet id are written to `wallets`
   (`turnkey_sub_org_id`, `turnkey_wallet_id`) — there is no formula that re-derives these the
   way `(verifier, verifierId)` used to, so losing this row means losing the mapping, even
   though the underlying Turnkey resources still exist.
4. `ensureGasFor` runs as before — a wallet that cannot pay gas cannot do anything.

Because Saku's API keypair is the sub-org's root user, the *same* server-side credentials that
created the sub-org can also sign with it later. There is no per-user Turnkey credential to
mint, store, or rotate.

## How a signature happens

`useMpcWallet`'s `getSigner()` returns a `TurnkeyBackendSigner` — a plain `ethers.AbstractSigner`
whose `signTransaction` does not sign anything locally. It serializes the populated, unsigned
transaction and POSTs it to `/api/mpc/sign` with the caller's session token. That route:

1. Verifies the session token.
2. Looks up `turnkey_sub_org_id` for `session.userId` — **never from the request body**, so a
   caller can only ever sign with their own wallet.
3. Calls `signWithWallet` (`lib/turnkey.ts`), which asks Turnkey to sign against that
   sub-organization using Saku's root API keypair.
4. Returns the signed, `0x`-prefixed raw transaction. `ethers`' own `sendTransaction` then
   broadcasts it exactly as it would a locally-signed one — nothing else in the app (transfer,
   offramp, staking, packet creation) had to change, because the signer's public interface is
   unchanged.

## Dashboard configuration

Create an organization at [app.turnkey.com](https://app.turnkey.com), then under **Team → your
root user → API Keys**, create a new key. Turnkey generates the P-256 keypair in the browser and
shows the private half exactly once — save it immediately, it cannot be recovered afterward.

| Env var | Value |
|---|---|
| `TURNKEY_ORGANIZATION_ID` | The organization id shown under the account menu |
| `TURNKEY_API_PUBLIC_KEY` | Public key from the API key you created |
| `TURNKEY_API_PRIVATE_KEY` | Private key shown once at creation — server-side only |
| `TURNKEY_BASE_URL` | `https://api.turnkey.com` |

Nothing here is public — unlike the old `NEXT_PUBLIC_WEB3AUTH_*` vars, none of these should ever
reach the browser. There is no JWKS endpoint to expose and no tunnel to keep alive in
development; that entire class of setup (and the fragile-tunnel failure mode that came with it)
is gone.

Two things worth knowing before touching this in production:

- **The API key created above is a root-level credential for every sub-organization Saku
  creates**, not scoped to a single action. Turnkey supports narrower **Service Users** with
  policy-restricted permissions for exactly this reason; using the root key directly was the
  pragmatic choice for getting signing working again, not the recommended production setup.
  Narrowing this to a policy-scoped service user is a fast-follow, not optional forever.
- **`wallets.turnkey_sub_org_id` is the only record of which sub-organization belongs to which
  user.** Back it up like anything else load-bearing; there's no `(verifier, verifierId)`
  formula to fall back on if it's lost.

## Existing Web3Auth-era wallets

Addresses created under the old integration are not migrated. `/api/mpc/provision` creates a
fresh Turnkey wallet for any user whose `wallets` row doesn't already have a
`turnkey_sub_org_id`, overwriting the old (Web3Auth-derived) address in that row. This is a
deliberate clean cutover, acceptable because the affected wallets are testnet accounts holding
test tokens — it would not be the right call for a production user base holding real funds,
which would need an explicit key-export/import migration instead.

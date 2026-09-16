/**
 * Nonce allocation for transactions signed in the browser.
 *
 * ethers' `AbstractSigner.populateTransaction` asks for `getNonce("pending")`, and on the BSC
 * Testnet RPC this app points at that single call is the slowest thing in the entire product.
 * Measured against `bsc-testnet-rpc.publicnode.com`, six consecutive calls:
 *
 *   eth_getTransactionCount(address, "pending")   10.4s  11.0s  11.1s  11.7s  17.1s  17.8s
 *   eth_getTransactionCount(address, "latest")    0.17s  0.19s  0.22s  0.24s
 *
 * Every other call in a transfer is in the low hundreds of milliseconds — `eth_estimateGas` 0.19s,
 * `eth_feeHistory` 0.18s — so the pending nonce was not part of the cost, it *was* the cost. And
 * because `populateTransaction` runs strictly in sequence, nothing overlapped it. A transfer pays
 * it twice, once for the payment and once for the platform fee.
 *
 * The public node is doing real work for that number: "pending" means "walk the mempool for this
 * address on top of the head block", and a public endpoint serving everyone's mempool queries is
 * where it shows. "latest" is a state lookup at a fixed block, which is why it is two orders of
 * magnitude cheaper.
 *
 * So this module asks for "latest" and makes up the difference itself. "latest" counts only mined
 * transactions, so a second transaction sent before the first is mined would reuse a nonce and be
 * rejected. A reservation closes that gap: after a transaction is accepted by the node at nonce N,
 * this module remembers N+1 for that wallet and hands that out until the chain catches up.
 *
 * The reservation expires, deliberately. A transaction that is dropped from the mempool instead of
 * mined would otherwise leave this module permanently one ahead of the chain, and every later
 * transaction would sit unmineable behind a nonce gap that never fills. After `RESERVATION_TTL_MS`
 * of no accepted transaction the chain is believed instead — worst case the user repeats a
 * transaction that was never going to land anyway.
 */

/** Just the slice of a provider this needs, so the tests do not have to build a real one. */
export interface NonceSource {
  getTransactionCount(address: string, blockTag: string): Promise<number>;
}

/**
 * How long a reservation outlives the transaction that created it.
 *
 * BSC Testnet produces a block every few seconds, so a transaction that has not mined in 90
 * seconds is not slow, it is gone. Holding the reservation past that point protects a transaction
 * that no longer exists at the cost of every transaction after it.
 */
export const RESERVATION_TTL_MS = 90_000;

interface Reservation {
  /** The nonce to hand out next. */
  next: number;
  /** When the transaction that produced this reservation was accepted. */
  at: number;
}

const reservations = new Map<string, Reservation>();

/** Keyed by chain as well as address: the same wallet has an unrelated nonce on another chain. */
const keyFor = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`;

/**
 * The nonce to sign the next transaction from `address` with.
 *
 * Always reads the chain — the reservation raises that answer, it never replaces it. A wallet
 * whose nonce moved elsewhere (a server-side sweep, another tab, a refund) is still followed.
 */
export async function allocateNonce(
  source: NonceSource,
  chainId: number,
  address: string,
  now: number = Date.now()
): Promise<number> {
  const mined = await source.getTransactionCount(address, 'latest');

  const held = reservations.get(keyFor(chainId, address));
  if (!held) return mined;
  if (now - held.at > RESERVATION_TTL_MS) {
    reservations.delete(keyFor(chainId, address));
    return mined;
  }

  return Math.max(mined, held.next);
}

/**
 * Record that the node accepted a transaction from `address` at `nonce`.
 *
 * Called after a successful broadcast and never before one: a reservation made for a transaction
 * that then failed to send is a nonce gap, which is the one failure mode this whole approach has
 * to avoid.
 */
export function reserveNonce(
  chainId: number,
  address: string,
  nonce: number,
  now: number = Date.now()
): void {
  const key = keyFor(chainId, address);
  const held = reservations.get(key);
  // Never walk backwards. Two transactions can be broadcast out of order, and the later one
  // having landed is not a reason to hand its nonce out again.
  if (held && held.next > nonce + 1 && now - held.at <= RESERVATION_TTL_MS) return;
  reservations.set(key, { next: nonce + 1, at: now });
}

/**
 * Forget what is held for `address`, so the next allocation trusts the chain alone.
 *
 * Used when a broadcast is rejected. Whatever this module believed about the wallet's nonce, the
 * node has just disagreed with it, and the node is the one that decides.
 */
export function releaseNonces(chainId: number, address: string): void {
  reservations.delete(keyFor(chainId, address));
}

/** Test seam. Nothing in the app clears every wallet at once. */
export function __resetNonceReservations(): void {
  reservations.clear();
}

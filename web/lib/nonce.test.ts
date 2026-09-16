import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  RESERVATION_TTL_MS,
  __resetNonceReservations,
  allocateNonce,
  releaseNonces,
  reserveNonce,
  type NonceSource,
} from '@/lib/nonce';

const CHAIN = 97;
const WALLET = '0xAbC0000000000000000000000000000000000001';

/** A provider stub that answers from a fixed mined count and records what it was asked. */
function source(minedCount: number) {
  const asked: string[] = [];
  const stub: NonceSource & { asked: string[] } = {
    asked,
    async getTransactionCount(_address: string, blockTag: string) {
      asked.push(blockTag);
      return minedCount;
    },
  };
  return stub;
}

beforeEach(() => __resetNonceReservations());

describe('allocateNonce', () => {
  it('never asks the node for the pending nonce', async () => {
    // The whole point of the module: "pending" costs 10-18s on this RPC, "latest" costs 0.2s.
    const node = source(7);
    await allocateNonce(node, CHAIN, WALLET);
    reserveNonce(CHAIN, WALLET, 7);
    await allocateNonce(node, CHAIN, WALLET);

    assert.deepEqual(node.asked, ['latest', 'latest']);
  });

  it('returns the mined count when nothing is in flight', async () => {
    assert.equal(await allocateNonce(source(7), CHAIN, WALLET), 7);
  });

  it('does not reuse the nonce of a transaction the chain has not mined yet', async () => {
    // The failure "latest" alone would cause: broadcast at 7, ask again before it mines, get 7.
    const node = source(7);
    assert.equal(await allocateNonce(node, CHAIN, WALLET), 7);
    reserveNonce(CHAIN, WALLET, 7);
    assert.equal(await allocateNonce(node, CHAIN, WALLET), 8);
  });

  it('follows the chain once it has caught up past the reservation', async () => {
    reserveNonce(CHAIN, WALLET, 7);
    // Something else moved this wallet on-chain — a sweep, another device.
    assert.equal(await allocateNonce(source(12), CHAIN, WALLET), 12);
  });

  it('keeps separate reservations per wallet', async () => {
    const other = '0xDeF0000000000000000000000000000000000002';
    reserveNonce(CHAIN, WALLET, 7);
    assert.equal(await allocateNonce(source(3), CHAIN, other), 3);
  });

  it('keeps separate reservations per chain', async () => {
    reserveNonce(CHAIN, WALLET, 7);
    assert.equal(await allocateNonce(source(3), 56, WALLET), 3);
  });

  it('matches a reservation regardless of address casing', async () => {
    reserveNonce(CHAIN, WALLET.toLowerCase(), 7);
    assert.equal(await allocateNonce(source(7), CHAIN, WALLET.toUpperCase()), 8);
  });

  it('believes the chain again once a stale reservation expires', async () => {
    // A dropped transaction must not leave every later one stuck behind a nonce gap.
    const at = 1_000_000;
    reserveNonce(CHAIN, WALLET, 7, at);
    assert.equal(await allocateNonce(source(7), CHAIN, WALLET, at + RESERVATION_TTL_MS + 1), 7);
  });

  it('holds the reservation right up to the expiry', async () => {
    const at = 1_000_000;
    reserveNonce(CHAIN, WALLET, 7, at);
    assert.equal(await allocateNonce(source(7), CHAIN, WALLET, at + RESERVATION_TTL_MS), 8);
  });
});

describe('reserveNonce', () => {
  it('advances across a run of transactions', async () => {
    const node = source(4);
    for (const expected of [4, 5, 6]) {
      assert.equal(await allocateNonce(node, CHAIN, WALLET), expected);
      reserveNonce(CHAIN, WALLET, expected);
    }
  });

  it('does not walk backwards when an earlier transaction reports late', async () => {
    reserveNonce(CHAIN, WALLET, 9);
    reserveNonce(CHAIN, WALLET, 7);
    assert.equal(await allocateNonce(source(0), CHAIN, WALLET), 10);
  });
});

describe('releaseNonces', () => {
  it('falls back to the chain after a rejected broadcast', async () => {
    reserveNonce(CHAIN, WALLET, 7);
    releaseNonces(CHAIN, WALLET);
    assert.equal(await allocateNonce(source(7), CHAIN, WALLET), 7);
  });
});

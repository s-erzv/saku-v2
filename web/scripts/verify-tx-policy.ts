/**
 * What `/api/mpc/sign` will and will not sign, checked against the shapes that matter.
 *
 * Run it:  npm run verify:tx-policy
 *
 * There is no test framework in this project, and this is not the place to argue for one — but
 * `lib/tx-policy.ts` is the file standing between a live session and someone's balance, and a
 * change to it that quietly starts allowing an extra call is not something to find out about in
 * production. Plain node, no bundler, no dependencies beyond the ones already here.
 *
 * `verify-tx-policy.sh` runs this. It exists because `lib/tx-policy.ts` imports through the `@/`
 * alias, which node cannot resolve on its own, so the shell script writes a copy with that one
 * import rewritten and points this file at it. Only the import line differs — the logic under
 * test is byte-for-byte the module that ships.
 *
 * `scripts/` is excluded from tsconfig.json for the same reason: this file is checked by being
 * run, not by `tsc`, and pointing the app's compiler at an import that only exists at run time
 * would fail `next build` over a file the build never touches.
 *
 * The addresses come from the environment, so this checks the policy against the deployment it
 * is actually run for rather than against constants written down twice.
 */

import { Interface, Transaction, parseUnits } from 'ethers';
// @ts-expect-error — resolved at run time by scripts/verify-tx-policy.sh, which writes an
// alias-free copy of lib/tx-policy.ts next to this file. See that script for why.
import { assertSignable, TxPolicyError } from './.tx-policy.generated.ts';

const USDC = requireEnv('NEXT_PUBLIC_MOCK_USDC_ADDRESS');
const ESCROW = requireEnv('NEXT_PUBLIC_ESCROW_ADDRESS');
const STAKING = requireEnv('NEXT_PUBLIC_STAKING_ADDRESS');
const CHAIN = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 97);

/** A burn address, standing in for wherever an attacker would want the money to go. */
const ATTACKER = '0x000000000000000000000000000000000000dEaD';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set — run this with the deployment's env loaded.`);
    process.exit(2);
  }
  return value;
}

const erc20 = new Interface([
  'function transfer(address to, uint256 amount)',
  'function approve(address spender, uint256 amount)',
  'function mint(address to, uint256 amount)',
]);
const staking = new Interface([
  'function stake(uint256 amount)',
  'function unstake(uint256 amount)',
]);
const escrow = new Interface([
  'function lockForOfframp(uint256 amount, address token, bytes32 recipientPhoneHash, uint256 rateExpiry)',
]);

function tx(to: string | null, data: string, over: Record<string, unknown> = {}): string {
  return Transaction.from({
    to: to ?? undefined,
    data,
    value: 0,
    nonce: 1,
    gasLimit: BigInt(200_000),
    maxFeePerGas: BigInt(1_000_000_000),
    maxPriorityFeePerGas: 1n,
    chainId: CHAIN,
    type: 2,
    ...over,
  } as never).unsignedSerialized;
}

let passed = 0;
let failed = 0;

function expect(name: string, build: () => string, want: 'allow' | 'deny') {
  try {
    assertSignable(build());
    if (want === 'allow') {
      passed += 1;
      console.log(`  ok    ${name}`);
    } else {
      failed += 1;
      console.log(`  FAIL  ${name} — allowed, but must be denied`);
    }
  } catch (error) {
    const message = error instanceof TxPolicyError ? error.message : `unexpected error: ${error}`;
    if (want === 'deny') {
      passed += 1;
      console.log(`  ok    ${name} — denied: ${message}`);
    } else {
      failed += 1;
      console.log(`  FAIL  ${name} — denied, but must be allowed: ${message}`);
    }
  }
}

const amount = parseUnits('10', 6);

console.log('\nAllowed — every transaction Saku actually produces:');
expect('USDC.transfer to a recipient', () => tx(USDC, erc20.encodeFunctionData('transfer', [ATTACKER, amount])), 'allow');
expect('USDC.approve(escrow)', () => tx(USDC, erc20.encodeFunctionData('approve', [ESCROW, amount])), 'allow');
expect('USDC.approve(staking)', () => tx(USDC, erc20.encodeFunctionData('approve', [STAKING, amount])), 'allow');
expect('STAKING.stake', () => tx(STAKING, staking.encodeFunctionData('stake', [amount])), 'allow');
expect('STAKING.unstake', () => tx(STAKING, staking.encodeFunctionData('unstake', [amount])), 'allow');
expect('ESCROW.lockForOfframp', () => tx(ESCROW, escrow.encodeFunctionData('lockForOfframp', [amount, USDC, `0x${'11'.repeat(32)}`, 120])), 'allow');

console.log('\nDenied — the reason this file exists:');
expect('approve an attacker as spender', () => tx(USDC, erc20.encodeFunctionData('approve', [ATTACKER, BigInt(2) ** BigInt(255)])), 'deny');
expect('call a contract Saku does not know', () => tx(ATTACKER, '0xdeadbeef'), 'deny');
expect('send native currency out', () => tx(USDC, erc20.encodeFunctionData('transfer', [ATTACKER, amount]), { value: parseUnits('1', 18) }), 'deny');
expect('sign for another chain', () => tx(USDC, erc20.encodeFunctionData('transfer', [ATTACKER, amount]), { chainId: 1 }), 'deny');
expect('deploy a contract', () => tx(null, '0x60806040'), 'deny');
expect('claim an absurd gas limit', () => tx(USDC, erc20.encodeFunctionData('transfer', [ATTACKER, amount]), { gasLimit: BigInt(30_000_000) }), 'deny');
expect('an unlisted method on a known contract', () => tx(USDC, erc20.encodeFunctionData('mint', [ATTACKER, amount])), 'deny');
expect('off-ramp lock of a foreign token', () => tx(ESCROW, escrow.encodeFunctionData('lockForOfframp', [amount, ATTACKER, `0x${'11'.repeat(32)}`, 120])), 'deny');
expect('a payload that is not a transaction', () => '0xnothexatall', 'deny');

console.log('\nAmounts counted against the daily cap:');
for (const [label, built, want] of [
  ['transfer', tx(USDC, erc20.encodeFunctionData('transfer', [ATTACKER, amount])), amount],
  // An allowance is not a spend — counting it would exhaust the cap without moving anything.
  ['approve', tx(USDC, erc20.encodeFunctionData('approve', [ESCROW, amount])), BigInt(0)],
  // Unstaking moves value *in*. Counting it would lock people out of their own funds.
  ['unstake', tx(STAKING, staking.encodeFunctionData('unstake', [amount])), BigInt(0)],
] as const) {
  const got = assertSignable(built).usdcOut;
  const ok = got === want;
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label} counts ${got}, expected ${want}`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

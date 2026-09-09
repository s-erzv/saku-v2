'use client';

/**
 * Staking — stake USDC, earn USDC.
 *
 * Every call here is signed on the user's device, like every other value transfer in v2: the
 * server has no path to move a stake, and there is no custodial step. Reads go through a plain
 * RPC provider, since a balance needs no signature.
 *
 * The APY shown is derived from the contract's own funded stream, not a number in the UI. When
 * the reward pool runs dry the rate reads zero, which is the honest answer.
 */

import { useCallback, useEffect, useState } from 'react';
import { Contract, JsonRpcProvider, formatUnits, parseUnits } from 'ethers';
import { useMpcWallet } from './useMpcWallet';
import { CONTRACTS, MAX_APPROVAL, NETWORK_CONFIG, RECEIPT_POLLING_MS } from '@/lib/config';
import { awaitWarmApproval } from './useWarmApproval';

const USDC_DECIMALS = 6;

/**
 * Above this, the number stops meaning anything to a reader even though it's arithmetically
 * correct. `currentApyBps` is a fixed reward budget divided by whatever is currently staked
 * (`rewardRate * 365 days * 10_000 / totalStaked`), so a nearly-empty pool — one test stake of a
 * few USDC against a 50,000 USDC/year budget — produces a percentage in the millions. Real once
 * enough is staked for the ratio to mean something; not a contract bug to "fix" by changing the
 * accrual math.
 */
const APY_DISPLAY_CAP = 999;

export const STAKING_ABI = [
  'function stake(uint256 amount)',
  'function unstake(uint256 amount)',
  'function claimRewards() returns (uint256)',
  'function exit()',
  'function pendingRewards(address user) view returns (uint256)',
  'function getStakeInfo(address user) view returns (uint256 staked, uint256 pending, uint256 stakedAt, uint256 poolTotal)',
  'function totalStaked() view returns (uint256)',
  'function minStakeAmount() view returns (uint256)',
  'function currentApyBps() view returns (uint256)',
  'function rewardReserve() view returns (uint256)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
];

export function getStakingAddress(): string {
  return process.env.NEXT_PUBLIC_STAKING_ADDRESS ?? '';
}

export interface StakingInfo {
  /** The caller's staked principal, human-readable. */
  staked: string;
  /** Claimable rewards right now. */
  pending: string;
  /** Everything staked by everyone — what the APY is spread across. */
  totalStaked: string;
  minStake: string;
  /** Annual rate implied by the funded stream. "0.00" once the pool is exhausted. */
  apy: string;
  /** True when the real rate exceeded {@link APY_DISPLAY_CAP} and `apy` was clamped to it. */
  apyCapped: boolean;
  /** Rewards still funded but not yet streamed. */
  rewardReserve: string;
  stakedAt: number;
}

export type StakingAction = 'idle' | 'staking' | 'unstaking' | 'claiming';

export function useStaking() {
  const { getSigner, address } = useMpcWallet();

  const [info, setInfo] = useState<StakingInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [action, setAction] = useState<StakingAction>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const stakingAddress = getStakingAddress();
    if (!stakingAddress) {
      setError('Staking is not configured');
      return;
    }

    setIsLoading(true);
    try {
      const provider = new JsonRpcProvider(NETWORK_CONFIG.rpcUrl, NETWORK_CONFIG.chainId, {
        staticNetwork: true,
        pollingInterval: RECEIPT_POLLING_MS,
      });
      const staking = new Contract(stakingAddress, STAKING_ABI, provider);

      const [total, minStake, apyBps, reserve] = await Promise.all([
        staking.totalStaked(),
        staking.minStakeAmount(),
        staking.currentApyBps(),
        staking.rewardReserve(),
      ]);

      let staked = BigInt(0);
      let pending = BigInt(0);
      let stakedAt = 0;

      if (address) {
        const result = await staking.getStakeInfo(address);
        staked = BigInt(result[0]);
        pending = BigInt(result[1]);
        stakedAt = Number(result[2]);
      }

      const rawApy = Number(apyBps) / 100;
      const apyCapped = rawApy > APY_DISPLAY_CAP;

      setInfo({
        staked: formatUnits(staked, USDC_DECIMALS),
        pending: formatUnits(pending, USDC_DECIMALS),
        totalStaked: formatUnits(total, USDC_DECIMALS),
        minStake: formatUnits(minStake, USDC_DECIMALS),
        apy: (apyCapped ? APY_DISPLAY_CAP : rawApy).toFixed(2),
        apyCapped,
        rewardReserve: formatUnits(reserve, USDC_DECIMALS),
        stakedAt,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load staking');
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Wrap a signed call so every action shares the same error handling and refresh. */
  const run = useCallback(
    async (label: StakingAction, fn: (staking: Contract) => Promise<{ hash: string; wait: () => Promise<unknown> }>) => {
      setAction(label);
      setError(null);

      try {
        const signer = await getSigner();
        const staking = new Contract(getStakingAddress(), STAKING_ABI, signer);

        const tx = await fn(staking);
        setLastTxHash(tx.hash);
        await tx.wait();
        await refresh();
        return tx.hash;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Transaction failed';
        setError(/insufficient funds/i.test(message) ? 'Not enough tBNB for gas.' : message);
        return null;
      } finally {
        setAction('idle');
      }
    },
    [getSigner, refresh]
  );

  const stake = useCallback(
    async (amount: string) => {
      const value = parseUnits(amount, USDC_DECIMALS);

      setAction('staking');
      setError(null);
      try {
        const signer = await getSigner();
        const usdc = new Contract(CONTRACTS.USDC, ERC20_ABI, signer);
        const stakingAddress = getStakingAddress();

        if (address) {
          const balance: bigint = await usdc.balanceOf(address);
          if (balance < value) throw new Error('Not enough USDC in your wallet.');

          // Approved once for everything, for the same reason as the off-ramp: the second MPC
          // signature costs far more waiting than the approval transaction does. Joins the
          // screen's warm approval if one is still mining.
          await awaitWarmApproval(address, stakingAddress);
          const allowance: bigint = await usdc.allowance(address, stakingAddress);
          if (allowance < value) {
            const approval = await usdc.approve(stakingAddress, MAX_APPROVAL);
            await approval.wait();
          }
        }

        const staking = new Contract(stakingAddress, STAKING_ABI, signer);
        const tx = await staking.stake(value);
        setLastTxHash(tx.hash);
        await tx.wait();
        await refresh();
        return tx.hash as string;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not stake';
        setError(/insufficient funds/i.test(message) ? 'Not enough tBNB for gas.' : message);
        return null;
      } finally {
        setAction('idle');
      }
    },
    [address, getSigner, refresh]
  );

  const unstake = useCallback(
    (amount: string) =>
      run('unstaking', (staking) => staking.unstake(parseUnits(amount, USDC_DECIMALS))),
    [run]
  );

  const claim = useCallback(() => run('claiming', (staking) => staking.claimRewards()), [run]);

  return { info, isLoading, action, error, lastTxHash, refresh, stake, unstake, claim };
}

"use client"

/**
 * Earn — stake USDC, earn USDC.
 *
 * The APY on this screen is read from the contract, computed from a reward stream that is
 * actually funded with tokens the contract holds. When the pool runs out it reads 0.00%, which
 * is the honest number rather than a marketing one.
 *
 * Staking and unstaking are signed on the device like every other transfer in v2. Nothing here
 * is custodial: the principal sits in a contract whose owner cannot withdraw it.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle, ExternalLink, Loader2, TrendingUp, Wallet } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useMpcWallet } from "@/hooks/useMpcWallet"
import { useTokenBalances } from "@/hooks/useTokenBalances"
import { useStaking, getStakingAddress } from "@/hooks/useStaking"
import { useWarmApproval } from "@/hooks/useWarmApproval"
import { CONTRACTS, explorerTxUrl } from "@/lib/config"
import BottomNavigation from "@/components/home/bottom-navigation"

type Tab = "stake" | "unstake"

export default function StakingPage() {
  const router = useRouter()
  const { user, wallet, isLoading, isAuthenticated } = useAuth()
  const { address, status } = useMpcWallet()
  const { info, isLoading: loadingInfo, action, error, lastTxHash, stake, unstake, claim } = useStaking()

  const [tab, setTab] = useState<Tab>("stake")
  const [amount, setAmount] = useState("")
  /**
   * What the last claim actually paid out, kept so the screen can say so.
   *
   * Claiming used to leave no trace: the reward figure went to zero, the button that named the
   * amount unmounted with it, and the only evidence left was a "View last transaction" link
   * shared with staking and unstaking. On a reward of 0.17 USDC against a balance in the
   * hundreds, nothing on screen visibly moved — so a claim that worked perfectly was
   * indistinguishable from one that did nothing. The amount has to be read before the claim,
   * because afterwards the contract reports zero.
   */
  const [claimed, setClaimed] = useState<string | null>(null)

  const walletAddress = address ?? wallet?.address ?? null
  const { balances, refresh } = useTokenBalances(walletAddress)
  // Warmed while the user picks an amount, so their first stake is a single signature.
  useWarmApproval(getStakingAddress())
  const usdc = balances.find((t) => t.address.toLowerCase() === CONTRACTS.USDC.toLowerCase())

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/get-started")
  }, [isLoading, isAuthenticated, router])

  useEffect(() => {
    if (action === "idle" && lastTxHash) void refresh()
  }, [action, lastTxHash, refresh])

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-black/20" />
      </div>
    )
  }

  if (!user) return null

  const busy = action !== "idle"
  const amountNum = Number(amount)
  const available = tab === "stake" ? Number(usdc?.formatted ?? 0) : Number(info?.staked ?? 0)
  const minStake = Number(info?.minStake ?? 1)
  const valid =
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    amountNum <= available &&
    (tab === "unstake" || amountNum >= minStake)

  const hasPending = Number(info?.pending ?? 0) > 0

  return (
    <div className="min-h-dvh bg-white font-sans max-w-lg mx-auto">
      <div className="px-5 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/home")}
            aria-label="Back"
            className="p-2 -ml-2 rounded-full hover:bg-black/5 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-black tracking-tight">Earn</h1>
        </div>

        {status !== "connected" ? (
          // Neutral, not amber. Warm is the brand on this screen now, and a notice wearing the
          // brand colour reads as a highlight rather than a hold-up.
          <div className="p-5 rounded-3xl bg-black/[0.03] border border-black/8 flex items-start gap-3">
            <Wallet className="w-5 h-5 text-black/40 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-bold">Wallet not ready</p>
              <p className="text-xs text-black/50">Finish setting up your wallet from Home first.</p>
            </div>
          </div>
        ) : (
          <>
            {/* Saku's own gradient, composed from the two brand tokens rather than a third
                copy of the hex pair. It existed in `globals.css` and was reaching exactly one
                surface, the bottom navigation, while this screen borrowed the dark slab from
                Home's balance card — which made Earn read as a second balance screen instead of
                its own thing. Dark now belongs to the balance and warm belongs to Saku.

                Ink is black-with-opacity, the same idiom as the rest of the app. White on a
                #FFD364 top stop is unreadable, so the whole card flips to dark ink.

                The small labels are `black/65` and not the `black/45` used elsewhere, which is
                not a taste call: measured against the darker stop of this gradient, 45% gives a
                contrast ratio of 2.9 where AA asks 4.5 for text this size, and 65% is the first
                step that clears it on both stops. The large figures pass at any of these. */}
            <div
              className="rounded-[2rem] p-6 space-y-5"
              style={{
                background:
                  "linear-gradient(135deg, var(--color-saku-yellow) 0%, var(--color-saku-orange) 100%)",
                boxShadow: "0 20px 44px rgba(240, 163, 83, 0.38)",
              }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-black/65">
                    Current APY
                  </p>
                  <p className="text-4xl font-black tabular-nums mt-1">
                    {loadingInfo && !info ? "—" : `${info?.apy ?? "0.00"}${info?.apyCapped ? "%+" : "%"}`}
                  </p>
                </div>
                <div className="p-2.5 rounded-2xl bg-black/10">
                  <TrendingUp className="w-5 h-5" />
                </div>
              </div>

              {info?.apyCapped && (
                <p className="text-[11px] text-black/65 -mt-3">
                  Early pool — few tokens staked against the funded reward budget skews the rate
                  this high. It settles as more is staked.
                </p>
              )}

              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-black/10">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-widest text-black/65">
                    You staked
                  </p>
                  <p className="text-xl font-black tabular-nums mt-0.5">{info?.staked ?? "0"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-widest text-black/65">
                    Earned
                  </p>
                  {/* Was emerald, the one cold accent on the screen and the only place green
                      carried meaning here. On the warm card it is simply ink like its
                      neighbour: what makes it read as earnings is the label above it. */}
                  <p className="text-xl font-black tabular-nums mt-0.5">
                    {info?.pending ?? "0"}
                  </p>
                </div>
              </div>

              <p className="text-[11px] text-black/65">
                Pool total {info?.totalStaked ?? "0"} USDC · {info?.rewardReserve ?? "0"} USDC of
                rewards still funded
              </p>
              {/* Inside the card, because it acts on the figure two lines above it. Outside, in
                  Saku orange, it was a second full-width accent button sitting directly above a
                  black one — two primary actions in two different colours, neither deferring to
                  the other. White on the gradient keeps it clearly the card's own action and
                  leaves the black button below as the screen's single primary. */}
              {hasPending && (
                <button
                  onClick={async () => {
                    const earned = info?.pending ?? "0"
                    const hash = await claim()
                    // Only on success; a rejected signature or a failed transaction must not
                    // report a payout that never happened.
                    if (hash) setClaimed(earned)
                  }}
                  disabled={busy}
                  className="w-full py-3 rounded-2xl bg-white font-bold text-sm shadow-sm disabled:opacity-60 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  {action === "claiming" && <Loader2 className="w-4 h-4 animate-spin" />}
                  {action === "claiming" ? "Claiming…" : `Claim ${info?.pending} USDC`}
                </button>
              )}
            </div>

            <div className="flex p-1 bg-black/[0.04] rounded-2xl">
              {(["stake", "unstake"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => { setTab(t); setAmount("") }}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold capitalize transition-all ${
                    tab === t ? "bg-white shadow-sm" : "text-black/45"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="rounded-3xl border border-black/8 bg-[#FAFAFA] px-5 py-6 text-center">
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-black/35">
                Amount to {tab}
              </p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder="0"
                  disabled={busy}
                  className="w-full max-w-[180px] bg-transparent outline-none text-center text-5xl font-black tabular-nums placeholder:text-black/15 disabled:opacity-50"
                />
                <span className="text-xl font-bold text-black/35">USDC</span>
              </div>

              <div className="mt-4 flex items-center justify-center gap-2 text-xs">
                <span className="text-black/40">
                  Available {available.toFixed(2)} USDC
                </span>
                <button
                  onClick={() => setAmount(String(available))}
                  disabled={busy || available <= 0}
                  className="font-bold text-amber-700 hover:underline disabled:opacity-40"
                >
                  Max
                </button>
              </div>

              {tab === "stake" && (
                <p className="mt-1 text-[11px] text-black/35">Minimum {info?.minStake ?? "1"} USDC</p>
              )}
            </div>

            {error && <p className="text-sm font-medium text-red-600">{error}</p>}

            <button
              onClick={() => (tab === "stake" ? stake(amount) : unstake(amount))}
              disabled={!valid || busy}
              className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-lg disabled:opacity-25 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {action === "staking" && "Staking…"}
              {action === "unstaking" && "Unstaking…"}
              {!busy && (tab === "stake" ? "Stake USDC" : "Unstake USDC")}
            </button>

            {claimed && !busy && (
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
                <div className="space-y-0.5 min-w-0">
                  <p className="text-sm font-bold text-amber-900 tabular-nums">
                    {claimed} USDC claimed
                  </p>
                  <p className="text-xs text-amber-800">
                    It is in your wallet balance now.
                  </p>
                </div>
              </div>
            )}

            {lastTxHash && !busy && (
              <a
                href={explorerTxUrl(lastTxHash)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-1.5 text-xs font-semibold text-amber-700 hover:underline"
              >
                View last transaction <ExternalLink className="w-3 h-3" />
              </a>
            )}

            <p className="text-[11px] text-center text-black/35">
              Rewards are funded, not minted — the contract only pays what it holds.
            </p>
          </>
        )}
      </div>

      <BottomNavigation />
    </div>
  )
}

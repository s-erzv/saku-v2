"use client"

/**
 * Top up: choose an amount of USDC, pay its price through Xendit.
 *
 * The user picks the isAuthenticated amount, not the fiat amount — they are buying USDC, and the fiat
 * figure is its price. Pricing the other way round is what produced amounts like "6.25 USDC"
 * with no way to ask for a round 10.
 *
 * The price is quoted in the user's own currency at a live rate, both resolved server-side from
 * their country (PRD Section 6). Nothing here is hardcoded to Indonesia.
 *
 * What the screen states plainly: the payment is real, the asset is a testnet isAuthenticated paid out of
 * the admin treasury. A demo that blurs those two is how people end up believing they bought
 * something.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { parseUnits } from "ethers"
import { ArrowLeft, CheckCircle, ExternalLink, Loader2, Receipt, TrendingDown, TrendingUp, Wallet } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useMpcWallet } from "@/hooks/useMpcWallet"
import { useTopup } from "@/hooks/useTopup"
import { type SakuTransaction } from "@/hooks/useTransactions"
import { CONTRACTS, explorerTxUrl } from "@/lib/config"
import ReceiptModal from "@/components/transactions/receipt-modal"

const QUICK_AMOUNTS = [5, 10, 25, 50]

/** The half of a quote that can be rendered as money: symbol, precision, and how to group it. */
interface Money {
  currency: string
  symbol: string
  decimals: number
  locale: string
  rate: number
}

interface Quote extends Money {
  source: "live" | "stale" | "fallback"
  /**
   * Whether a real charge happens. False on a Xendit sandbox account, which is what makes the
   * testnet warning below disappear on its own during a demo and come back in production.
   */
  realPayment: boolean
  feeBps: number
  direction: "up" | "down" | "flat"
  changePct: number
  previousRate: number | null
  minUsdc: number
  maxUsdc: number
}

/** The rate is re-checked while the screen is open, so a long session does not show a stale price. */
const RATE_REFRESH_MS = 60_000

export default function TopupPage() {
  const router = useRouter()
  const { user, wallet, isLoading, isAuthenticated, refreshUser } = useAuth()
  const { address } = useMpcWallet()
  const { phase, payoutTxHash, error, startTopup, reset } = useTopup()

  const [amount, setAmount] = useState<string>("")
  // The price comes from the server, in the user's own currency, at the current rate. The
  // client never decides it — `create-payment` re-prices independently at charge time, so a
  // tab left open overnight cannot lock in yesterday's rate.
  const [quote, setQuote] = useState<Quote | null>(null)
  /** Set briefly when the rate changes while the user is looking at it. */
  const [rateMoved, setRateMoved] = useState<"up" | "down" | null>(null)
  const [showReceipt, setShowReceipt] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch("/api/topup/quote")
        const data = await res.json()
        if (cancelled || !res.ok) return

        setQuote((current) => {
          // Flash the new price only when it actually moved, so a poll that changes nothing is
          // invisible rather than a blinking number.
          if (current && current.rate !== data.rate) {
            setRateMoved(data.rate > current.rate ? "up" : "down")
            setTimeout(() => setRateMoved(null), 4000)
          }
          return data
        })
      } catch {
        // Leaving `quote` null just hides the price preview; the amount field still works and
        // the server prices the charge either way.
      }
    }

    void load()
    const timer = setInterval(load, RATE_REFRESH_MS)

    return () => { cancelled = true; clearInterval(timer) }
  }, [isAuthenticated])

  const formatPrice = (value: number) =>
    quote
      ? `${quote.symbol}${value.toLocaleString(quote.locale, {
          minimumFractionDigits: quote.decimals,
          maximumFractionDigits: quote.decimals,
        })}`
      : "—"

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/get-started")
  }, [isLoading, isAuthenticated, router])

  useEffect(() => {
    if (phase === "done") void refreshUser()
  }, [phase, refreshUser])

  const walletAddress = address ?? wallet?.address ?? null
  const minUsdc = quote?.minUsdc ?? 1
  const maxUsdc = quote?.maxUsdc ?? 500
  const amountUsdc = Number(amount)
  const validAmount = Number.isFinite(amountUsdc) && amountUsdc >= minUsdc && amountUsdc <= maxUsdc
  // Mirrors lib/fees.ts: the fee is added on top, so the user receives exactly what they typed.
  const feeUsdc = validAmount && quote ? (amountUsdc * (quote.feeBps ?? 0)) / 10_000 : 0
  const subtotal = validAmount && quote ? amountUsdc * quote.rate : 0
  const feePrice = validAmount && quote ? feeUsdc * quote.rate : 0
  const price = subtotal + feePrice
  const busy = phase === "creating" || phase === "redirecting" || phase === "settling"

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-black/20" />
      </div>
    )
  }

  if (!user) return null

  if (phase === "done") {
    const receiptTx: SakuTransaction | null = payoutTxHash
      ? {
          txHash: payoutTxHash,
          type: "topup",
          status: "confirmed",
          amount: parseUnits(String(amountUsdc || 0), 6).toString(),
          tokenAddress: CONTRACTS.USDC,
          occurredAt: new Date().toISOString(),
          direction: "in",
          fromAddress: null,
          toAddress: walletAddress,
          // A top up has no human on the other end; the receipt prints the gateway instead.
          counterpartyName: null,
          counterpartyIsUser: false,
          context: null,
          feeAmount: parseUnits(feeUsdc.toFixed(6), 6).toString(),
        }
      : null

    return (
      // Matches the form the user was just on, and the callback screen they may have arrived
      // through instead — all three are the same `max-w-lg` column.
      <div className="min-h-dvh bg-white font-sans flex items-center justify-center">
        <div className="w-full max-w-lg mx-auto px-5 py-6 text-center space-y-6 animate-in zoom-in-95 duration-300">
          <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle className="w-8 h-8 text-emerald-600" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-2xl font-black tracking-tight">Top up complete</h1>
            <p className="text-sm text-black/50">
              {amountUsdc} USDC is now in your wallet
            </p>
          </div>

          {payoutTxHash && (
            <a
              href={explorerTxUrl(payoutTxHash)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-amber-700 hover:underline"
            >
              View on BscScan <ExternalLink className="w-3 h-3" />
            </a>
          )}

          <div className="space-y-2">
            {receiptTx && (
              <button
                onClick={() => setShowReceipt(true)}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border-2 border-black/12 text-sm font-bold hover:border-black/25 transition-colors"
              >
                <Receipt className="w-4 h-4" /> View receipt
              </button>
            )}
            <button
              onClick={() => router.push("/home")}
              className="w-full py-4 bg-black text-white rounded-2xl font-bold active:scale-[0.98] transition-transform"
            >
              Back to Home
            </button>
          </div>
        </div>

        {showReceipt && receiptTx && <ReceiptModal transaction={receiptTx} onClose={() => setShowReceipt(false)} />}
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-white font-sans">
      <div className="max-w-lg mx-auto px-5 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/home")}
            aria-label="Back"
            className="p-2 -ml-2 rounded-full hover:bg-black/5 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-black tracking-tight">Top Up</h1>
        </div>

        {!walletAddress ? (
          <div className="p-5 rounded-3xl bg-amber-50 border border-amber-200 flex items-start gap-3">
            <Wallet className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-bold text-amber-900">Wallet not ready</p>
              <p className="text-xs text-amber-800 leading-relaxed">
                Finish setting up your wallet from the Home screen before topping up.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div className="rounded-3xl border border-black/8 bg-[#FAFAFA] px-5 py-6 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-black/35">
                  Amount to receive
                </p>
                <div className="mt-3 flex items-center justify-center gap-2">
                  <input
                    inputMode="decimal"
                    value={amount}
                    autoFocus
                    onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                    placeholder="0"
                    disabled={busy}
                    className="w-full max-w-[180px] bg-transparent outline-none text-center text-5xl font-black tabular-nums disabled:opacity-50 placeholder:text-black/15"
                  />
                  <span className="text-xl font-bold text-black/35">USDC</span>
                </div>
                {validAmount && quote ? (
                  <div className="mt-4 space-y-1 text-sm">
                    <div className="flex justify-between text-black/45">
                      <span>Subtotal</span>
                      <span className="tabular-nums">{formatPrice(subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-black/45">
                      <span>Fee ({((quote.feeBps ?? 0) / 100).toFixed(2)}%)</span>
                      <span className="tabular-nums">{formatPrice(feePrice)}</span>
                    </div>
                    <div className="flex justify-between font-bold pt-1.5 border-t border-black/8">
                      <span>You pay</span>
                      <span className="tabular-nums">{formatPrice(price)}</span>
                    </div>

                  </div>
                ) : (
                  <p className="mt-4 text-sm font-semibold text-black/50">You pay —</p>
                )}
              </div>

              <div className="grid grid-cols-4 gap-2">
                {QUICK_AMOUNTS.map((value) => (
                  <button
                    key={value}
                    onClick={() => setAmount(String(value))}
                    disabled={busy}
                    className={`py-3 rounded-2xl text-sm font-bold border transition-all disabled:opacity-50 ${
                      amountUsdc === value
                        ? "border-black bg-black text-white"
                        : "border-black/10 bg-white hover:border-black/25"
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>

              {quote && (
                <div className="flex items-center justify-center gap-2 text-xs">
                  <span className="text-black/40">
                    {formatPrice(quote.rate)} / USDC
                  </span>

                  {/* Which way the rate moved since Saku last saw it change. */}
                  {quote.direction !== "flat" && quote.previousRate !== null && (
                    <span
                      className={`inline-flex items-center gap-0.5 font-semibold ${
                        quote.direction === "up" ? "text-red-600" : "text-emerald-600"
                      }`}
                      title={`Previously ${formatPrice(quote.previousRate)} / USDC`}
                    >
                      {quote.direction === "up" ? (
                        <TrendingUp className="w-3 h-3" />
                      ) : (
                        <TrendingDown className="w-3 h-3" />
                      )}
                      {quote.changePct > 0 ? "+" : ""}{quote.changePct.toFixed(2)}%
                    </span>
                  )}

                  {/* An approximate rate is labelled as one rather than shown as a quote. */}
                  {quote.source === "fallback" && (
                    <span className="text-amber-700 font-semibold">approx.</span>
                  )}
                  {rateMoved && (
                    <span className="text-black/45">
                      · rate just went {rateMoved}
                    </span>
                  )}
                </div>
              )}

              <p className="text-xs text-black/35 text-center">{minUsdc}–{maxUsdc} USDC</p>
            </div>

            {/*
              Only when money genuinely moves. On a Xendit sandbox account nothing is charged, so
              this is noise about a transaction that is not happening and the screen stays clean.
              The moment a production key is configured it returns by itself — taking real money
              for a isAuthenticated that only exists on a testnet is not something to leave unsaid.
            */}
            {quote?.realPayment && (
              <div className="p-4 rounded-2xl bg-black/[0.03] border border-black/5">
                <p className="text-[11px] leading-relaxed text-black/55">
                  <span className="font-bold text-black/75">Heads up:</span> the payment is processed
                  by Xendit and is real. What arrives in your wallet is USDC on BNB Smart Chain
                  Testnet — a test isAuthenticated, not a real-world asset.
                </p>
              </div>
            )}

            {error && <p className="text-sm font-medium text-red-600">{error}</p>}

            <button
              onClick={() => (phase === "failed" ? reset() : startTopup(amountUsdc))}
              disabled={busy || (phase !== "failed" && !validAmount)}
              className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-lg disabled:opacity-25 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {phase === "creating" && "Preparing payment…"}
              {phase === "redirecting" && "Opening checkout…"}
              {phase === "settling" && "Sending USDC to your wallet…"}
              {phase === "failed" && "Try again"}
              {phase === "idle" && "Continue to payment"}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

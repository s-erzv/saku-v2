"use client"

/**
 * Pay a Saku payment request.
 *
 * Wallet to wallet, signed on the payer's device. Saku holds nothing here and takes nothing —
 * a payer-side fee on a coffee is what makes people stop scanning (see `lib/fees.ts`).
 */

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle, ExternalLink, Loader2, QrCode } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useMpcWallet } from "@/hooks/useMpcWallet"
import { useTokenBalances } from "@/hooks/useTokenBalances"
import { usePayRequest } from "@/hooks/useQrPayment"
import { CONTRACTS, explorerTxUrl } from "@/lib/config"

export default function PayRequestPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  const router = useRouter()
  const { user, wallet, isLoading, isAuthenticated } = useAuth()
  const { address } = useMpcWallet()
  const { phase, details, error, paidTxHash, load, pay } = usePayRequest(code)

  const [amount, setAmount] = useState("")

  const walletAddress = address ?? wallet?.address ?? null
  const { balances, refresh } = useTokenBalances(walletAddress)
  const usdc = balances.find((t) => t.address.toLowerCase() === CONTRACTS.USDC.toLowerCase())

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/get-started")
  }, [isLoading, isAuthenticated, router])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (phase === "done") void refresh()
  }, [phase, refresh])

  if (isLoading || phase === "loading") {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-black/20" />
      </div>
    )
  }

  if (!user) return null

  if (phase === "done") {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-sm text-center space-y-6 animate-in zoom-in-95 duration-300">
          <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle className="w-8 h-8 text-emerald-600" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-2xl font-black tracking-tight">Paid</h1>
            <p className="text-sm text-black/50">
              {details?.amount ?? amount} USDC to {details?.payeeName}
            </p>
          </div>
          {paidTxHash && (
            <a
              href={explorerTxUrl(paidTxHash)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-amber-700 hover:underline"
            >
              View on BscScan <ExternalLink className="w-3 h-3" />
            </a>
          )}
          <button
            onClick={() => router.push("/home")}
            className="w-full py-4 bg-black text-white rounded-2xl font-bold active:scale-[0.98] transition-transform"
          >
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  if (!details) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center p-6 font-sans">
        <div className="text-center space-y-4 max-w-sm">
          <QrCode className="w-10 h-10 mx-auto text-black/15" />
          <p className="text-sm font-semibold text-black/60">{error ?? "Request not found"}</p>
          <button
            onClick={() => router.push("/pay")}
            className="w-full py-4 bg-black text-white rounded-2xl font-bold"
          >
            Back
          </button>
        </div>
      </div>
    )
  }

  const payAmount = details.amount ?? amount
  const canPay =
    details.payable &&
    Number(payAmount) > 0 &&
    (!usdc || Number(payAmount) <= Number(usdc.formatted))

  return (
    <div className="min-h-dvh bg-white font-sans">
      <div className="max-w-lg mx-auto px-5 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/pay")}
            aria-label="Back"
            className="p-2 -ml-2 rounded-full hover:bg-black/5 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-black tracking-tight">Pay</h1>
        </div>

        <div className="rounded-3xl border border-black/8 bg-[#FAFAFA] px-5 py-8 text-center space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-black/35">Paying</p>
          <p className="text-lg font-bold">{details.payeeName}</p>

          {details.amount ? (
            <p className="text-5xl font-black tabular-nums pt-2">{details.amount}</p>
          ) : (
            <div className="flex items-center justify-center gap-2 pt-2">
              <input
                inputMode="decimal"
                value={amount}
                autoFocus
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="0"
                className="w-full max-w-[160px] bg-transparent outline-none text-center text-5xl font-black tabular-nums placeholder:text-black/15"
              />
            </div>
          )}
          <p className="text-sm font-bold text-black/35">USDC</p>
          {details.note && <p className="text-sm text-black/45 pt-1">{details.note}</p>}
        </div>

        <div className="rounded-2xl border border-black/8 bg-[#FAFAFA] px-4 py-3 flex items-baseline justify-between">
          <span className="text-sm font-medium text-black/45">Your balance</span>
          <span className="text-lg font-black tabular-nums">{usdc?.formatted ?? "0"} USDC</span>
        </div>

        {error && <p className="text-sm font-medium text-red-600">{error}</p>}

        {details.isPayee ? (
          <p className="text-sm text-center text-black/45">This is your own request.</p>
        ) : !details.payable ? (
          <p className="text-sm text-center text-black/45">
            This request is {details.status}.
          </p>
        ) : (
          <button
            onClick={() => pay(amount)}
            disabled={!canPay || phase === "paying"}
            className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-lg disabled:opacity-25 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            {phase === "paying" && <Loader2 className="w-4 h-4 animate-spin" />}
            {phase === "paying" ? "Paying…" : `Pay ${payAmount || ""} USDC`}
          </button>
        )}

        <p className="text-[11px] text-center text-black/35">
          Sent wallet to wallet. No platform fee on QR payments.
        </p>
      </div>
    </div>
  )
}

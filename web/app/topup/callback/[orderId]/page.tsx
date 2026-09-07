"use client"

/**
 * Where Xendit sends the browser back to after checkout — every payment lands here, since
 * Xendit's checkout is a hosted page rather than an embedded widget.
 *
 * The page that started the topup is gone by the time the user lands back here, so the poll is
 * restarted from the order id in the URL.
 */

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle, ExternalLink, Loader2, XCircle } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useTopup } from "@/hooks/useTopup"
import { explorerTxUrl } from "@/lib/config"

export default function TopupCallbackPage({
  params,
}: {
  params: Promise<{ orderId: string }>
}) {
  const { orderId } = use(params)
  const router = useRouter()
  const { token, isLoading, isAuthenticated, refreshUser } = useAuth()
  const { phase, payoutTxHash, error, waitForSettlement } = useTopup()
  const [started, setStarted] = useState(false)

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/get-started")
  }, [isLoading, isAuthenticated, router])

  useEffect(() => {
    if (!token || started) return
    setStarted(true)
    void waitForSettlement(orderId)
  }, [token, started, orderId, waitForSettlement])

  useEffect(() => {
    if (phase === "done") void refreshUser()
  }, [phase, refreshUser])

  const settled = phase === "done"
  const failed = phase === "failed"

  return (
    <div className="min-h-[100dvh] bg-[#F9EFE5] flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-[360px] bg-white rounded-[2rem] p-8 shadow-xl text-center space-y-5">
        <div
          className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${
            settled ? "bg-emerald-50" : failed ? "bg-red-50" : "bg-black/5"
          }`}
        >
          {settled ? (
            <CheckCircle className="w-8 h-8 text-emerald-600" />
          ) : failed ? (
            <XCircle className="w-8 h-8 text-red-600" />
          ) : (
            <Loader2 className="w-8 h-8 animate-spin text-black/40" />
          )}
        </div>

        <div className="space-y-1">
          <h1 className="text-xl font-black tracking-tight">
            {settled ? "Top up complete" : failed ? "Not finished" : "Processing your top up…"}
          </h1>
          <p className="text-sm text-[#7F8790]">
            {settled
              ? "Your balance has been updated."
              : failed
                ? error ?? "The payment has not been confirmed."
                : "Waiting for payment confirmation and the on-chain payout."}
          </p>
        </div>

        <p className="text-[11px] font-mono text-[#7F8790] break-all">{orderId}</p>

        {payoutTxHash && (
          <a
            href={explorerTxUrl(payoutTxHash)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 text-xs font-semibold text-amber-700 hover:underline"
          >
            View on BscScan <ExternalLink className="w-3 h-3" />
          </a>
        )}

        <button
          onClick={() => router.push("/home")}
          className="w-full py-4 bg-black text-white rounded-2xl font-bold active:scale-[0.98] transition-all"
        >
          Back to Home
        </button>
      </div>
    </div>
  )
}

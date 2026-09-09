"use client"

/**
 * Pay a merchant QRIS code.
 *
 * The merchant details on this screen are read from the real code — name, city, NMID, acquirer,
 * and the amount when the merchant encoded one. The CRC is verified server-side, so a corrupted
 * or altered scan never reaches this screen as a merchant.
 *
 * What happens on confirm is the cross-rail path: the USDC is locked and swapped on-chain for
 * real, and the leg that would credit the merchant's QRIS account is simulated. That last part
 * is stated on the screen, before payment and again after, because a payment screen that lets
 * someone believe a merchant was actually paid is the one place this demo must not be vague.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, ArrowLeft, CheckCircle, ExternalLink, Loader2, Store } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useMpcWallet } from "@/hooks/useMpcWallet"
import { useTokenBalances } from "@/hooks/useTokenBalances"
import { useOfframp } from "@/hooks/useOfframp"
import { useWarmApproval } from "@/hooks/useWarmApproval"
import { keccak256, toUtf8Bytes } from "ethers"
import { CONTRACTS, explorerTxUrl } from "@/lib/config"
import { offrampFee } from "@/lib/fees"

interface QrisInfo {
  merchant: { name: string | null; city: string | null; id: string | null; acquirer: string | null }
  amount: number | null
  currency: string
  dynamic: boolean
  usdcNeeded: number | null
  feeUsdc: number | null
  netUsdc: number | null
  fxRate: number
  symbol: string
  locale: string
  decimals: number
}

export default function PayQrisPage() {
  const router = useRouter()
  const { user, wallet, isLoading, isAuthenticated } = useAuth()
  const { address, status } = useMpcWallet()
  const { phase, error: sendError, lockTxHash, result, send } = useOfframp()

  const [info, setInfo] = useState<QrisInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [manualAmount, setManualAmount] = useState("")

  const walletAddress = address ?? wallet?.address ?? null
  const { balances, refresh } = useTokenBalances(walletAddress)
  // Warmed while the merchant code is being read, so paying is a single signature.
  useWarmApproval(process.env.NEXT_PUBLIC_ESCROW_ADDRESS)
  const usdc = balances.find((t) => t.address.toLowerCase() === CONTRACTS.USDC.toLowerCase())

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/get-started")
  }, [isLoading, isAuthenticated, router])

  useEffect(() => {
    if (phase === "done") void refresh()
  }, [phase, refresh])

  useEffect(() => {
    if (!isAuthenticated) return

    const payload = (() => {
      try {
        return sessionStorage.getItem("saku_qris_payload")
      } catch {
        return null
      }
    })()

    if (!payload) {
      setLoadError("No QRIS code to pay. Scan one first.")
      return
    }

    void (async () => {
      try {
        const res = await fetch("/api/qris/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Could not read that code")
        setInfo(data)
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Could not read that code")
      }
    })()
  }, [isAuthenticated])

  const formatFiat = (value: number) =>
    info
      ? `${info.symbol}${value.toLocaleString(info.locale, {
          minimumFractionDigits: info.decimals,
          maximumFractionDigits: info.decimals,
        })}`
      : "—"

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-black/20" />
      </div>
    )
  }

  if (!user) return null

  if (phase === "done" && result) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-sm text-center space-y-6 animate-in zoom-in-95 duration-300">
          <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle className="w-8 h-8 text-emerald-600" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-2xl font-black tracking-tight">Payment sent</h1>
            <p className="text-sm text-black/50">{info?.merchant.name ?? "Merchant"}</p>
            {result.fiatAmount !== undefined && (
              <p className="text-lg font-black tabular-nums pt-1">{formatFiat(result.fiatAmount)}</p>
            )}
          </div>

          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3.5 flex gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <p className="text-[11px] leading-relaxed text-amber-900">
              The swap is real on-chain. Paying the merchant is{" "}
              <span className="font-bold">simulated</span> — they did not receive money.
            </p>
          </div>

          {result.settleTxHash && (
            <a
              href={explorerTxUrl(result.settleTxHash)}
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

  if (loadError) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center p-6 font-sans">
        <div className="text-center space-y-4 max-w-sm">
          <Store className="w-10 h-10 mx-auto text-black/15" />
          <p className="text-sm font-semibold text-black/60">{loadError}</p>
          <button
            onClick={() => router.push("/pay")}
            className="w-full py-4 bg-black text-white rounded-2xl font-bold"
          >
            Scan again
          </button>
        </div>
      </div>
    )
  }

  if (!info) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-black/20" />
      </div>
    )
  }

  // A static merchant code carries no amount, so the payer enters one — as at the counter. Priced
  // through the same fee-on-top formula as a dynamic code's amount, just computed client-side
  // since there is no server round-trip as the payer types.
  const manualAmountNum = Number(manualAmount)
  const manualFee = manualAmountNum > 0 ? offrampFee(manualAmountNum) : null
  const usdcToSend = info.usdcNeeded ?? manualFee?.grossUsdc ?? manualAmountNum
  const netUsdc = info.netUsdc ?? manualAmountNum
  const feeUsdc = info.feeUsdc ?? manualFee?.feeUsdc ?? null
  const fiatToPay = info.amount ?? manualAmountNum * info.fxRate
  const canPay =
    status === "connected" &&
    Number.isFinite(usdcToSend) &&
    usdcToSend > 0 &&
    (!usdc || usdcToSend <= Number(usdc.formatted))
  const busy = phase === "approving" || phase === "locking" || phase === "settling"

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
          <h1 className="text-xl font-black tracking-tight">QRIS</h1>
        </div>

        <div className="rounded-3xl border border-black/8 bg-[#FAFAFA] px-5 py-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-black/[0.06] flex items-center justify-center">
              <Store className="w-5 h-5 text-black/50" />
            </div>
            <div className="min-w-0">
              <p className="text-base font-bold truncate">{info.merchant.name ?? "Merchant"}</p>
              <p className="text-[11px] text-black/40 truncate">
                {info.merchant.city ?? "—"}
                {info.merchant.id && ` · ${info.merchant.id}`}
              </p>
            </div>
          </div>

          <div className="pt-3 border-t border-black/8 text-center">
            {info.amount !== null ? (
              <>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-black/35">
                  Amount
                </p>
                <p className="text-4xl font-black tabular-nums mt-1">{formatFiat(info.amount)}</p>
              </>
            ) : (
              <>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-black/35">
                  Enter amount (USDC)
                </p>
                <div className="mt-2 flex items-center justify-center gap-2">
                  <input
                    inputMode="decimal"
                    value={manualAmount}
                    autoFocus
                    onChange={(e) => setManualAmount(e.target.value.replace(/[^\d.]/g, ""))}
                    placeholder="0"
                    className="w-full max-w-[160px] bg-transparent outline-none text-center text-4xl font-black tabular-nums placeholder:text-black/15"
                  />
                  <span className="text-lg font-bold text-black/35">USDC</span>
                </div>
                {Number(manualAmount) > 0 && (
                  <p className="mt-2 text-sm text-black/45">≈ {formatFiat(fiatToPay)}</p>
                )}
              </>
            )}
          </div>

          {usdcToSend > 0 && (
            <div className="pt-3 border-t border-black/8 space-y-1.5 text-sm">
              {feeUsdc !== null && (
                <div className="flex justify-between text-black/45">
                  <span>Fee (added on top)</span>
                  <span className="tabular-nums">+{feeUsdc} USDC</span>
                </div>
              )}
              <div className="flex justify-between text-black/45">
                <span>You pay</span>
                <span className="tabular-nums font-bold text-black/70">{usdcToSend} USDC</span>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3.5 flex gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <p className="text-[11px] leading-relaxed text-amber-900">
            Saku is not a QRIS acquirer — crediting this merchant is{" "}
            <span className="font-bold">simulated</span>.
          </p>
        </div>

        <div className="rounded-2xl border border-black/8 bg-[#FAFAFA] px-4 py-3 flex items-baseline justify-between">
          <span className="text-sm font-medium text-black/45">Your balance</span>
          <span className="text-lg font-black tabular-nums">{usdc?.formatted ?? "0"} USDC</span>
        </div>

        {sendError && <p className="text-sm font-medium text-red-600">{sendError}</p>}

        <button
          onClick={() => {
            // The merchant is identified by their NMID; it is hashed into the same recipient
            // field the escrow uses for a phone, so the lock carries who was paid.
            const merchantRef = info.merchant.id ?? info.merchant.name ?? "unknown-merchant"
            void send(String(netUsdc), String(usdcToSend), "bank", merchantRefHash(merchantRef))
          }}
          disabled={!canPay || busy}
          className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-lg disabled:opacity-25 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {phase === "approving" && "Approving…"}
          {phase === "locking" && "Locking funds…"}
          {phase === "settling" && "Paying merchant…"}
          {!busy && "Confirm payment"}
        </button>

        {lockTxHash && !busy && (
          <p className="text-[11px] text-center text-black/35 font-mono break-all">{lockTxHash}</p>
        )}
      </div>
    </div>
  )
}

/**
 * A bytes32 reference for the merchant, so the on-chain lock records who it was for.
 *
 * The escrow's `recipientPhoneHash` is just a bytes32 identifier. A merchant NMID hashed with
 * keccak256 — the same function `lib/phone.ts` uses — fits it without pretending to be a phone
 * number, and stays consistent with every other identifier the contract sees.
 */
function merchantRefHash(value: string): string {
  return keccak256(toUtf8Bytes(`qris:${value}`))
}

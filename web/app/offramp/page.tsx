"use client"

/**
 * Cross-rail transfer — send from Saku to a GoPay/OVO/DANA/ShopeePay number.
 *
 * This is the PRD's core use case (Section 3): from the sender's side it is a signed on-chain
 * transaction, and from the recipient's side it looks like an ordinary e-wallet transfer.
 *
 * The screen is explicit about which half is real, because the PRD requires it to be
 * (Section 4): the lock and the PancakeSwap swap genuinely happen on BSC Testnet and can be
 * checked on BscScan, while converting to rupiah and paying it into an e-wallet is simulated —
 * Saku holds no payment licence and does not pretend to.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle, ExternalLink, Loader2, RotateCcw, Wallet } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useMpcWallet } from "@/hooks/useMpcWallet"
import { useTokenBalances } from "@/hooks/useTokenBalances"
import { useOfframp } from "@/hooks/useOfframp"
import { useWarmApproval } from "@/hooks/useWarmApproval"
import { CONTRACTS, explorerTxUrl } from "@/lib/config"
import { RAILS, type Rail } from "@/lib/mock-fiat"
import CountryCodeDropdown from "@/components/get-started/country-code-dropdown"

interface Quote {
  stableOut?: number
  fiatAmount?: number
  currency: string
  symbol: string
  decimals: number
  locale: string
  fxRate: number
  fxSource: "live" | "stale" | "fallback"
  minUsdc: number
  maxUsdc: number
  rateExpirySeconds: number
  feeUsdc?: number
  netUsdc?: number
  feeBps?: number
}

type Step = "form" | "review"

export default function OfframpPage() {
  const router = useRouter()
  const { user, wallet, token, isLoading, isAuthenticated } = useAuth()
  const { address, status } = useMpcWallet()
  const { phase, error, lockTxHash, result, recipientHash, resolveRecipient, send, requestRefund } = useOfframp()

  const [step, setStep] = useState<Step>("form")
  const [countryCode, setCountryCode] = useState("+62")
  const [phone, setPhone] = useState("")
  const [rail, setRail] = useState<Rail>("gopay")
  const [amount, setAmount] = useState("")
  const [quote, setQuote] = useState<Quote | null>(null)
  const [banks, setBanks] = useState<{ code: string; name: string }[]>([])
  const [loadingBanks, setLoadingBanks] = useState(false)
  const [bankCode, setBankCode] = useState("")
  const [accountNumber, setAccountNumber] = useState("")

  const walletAddress = address ?? wallet?.address ?? null
  const { balances, refresh } = useTokenBalances(walletAddress)
  // Granted in the background while the destination and amount are being filled in, so the
  // first transfer costs one signature instead of two.
  useWarmApproval(process.env.NEXT_PUBLIC_ESCROW_ADDRESS)
  const usdc = balances.find((t) => t.address.toLowerCase() === CONTRACTS.USDC.toLowerCase())

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/get-started")
  }, [isLoading, isAuthenticated, router])

  useEffect(() => {
    if (phase === "done") void refresh()
  }, [phase, refresh])

  // Fetched once, lazily — most transfers never touch the bank rail, so there's no reason to
  // pull Xendit's 150+-entry bank list on every visit to this screen.
  useEffect(() => {
    if (rail !== "bank" || banks.length > 0 || loadingBanks || !token) return
    setLoadingBanks(true)
    fetch("/api/offramp/banks", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((data) => { if (Array.isArray(data.banks)) setBanks(data.banks) })
      .catch(() => {})
      .finally(() => setLoadingBanks(false))
  }, [rail, banks.length, loadingBanks, token])

  // Re-quote as the amount changes: the on-chain half comes from the live pool, so the number
  // moves with real liquidity rather than a fixed formula.
  useEffect(() => {
    if (!token) return
    const amountUsdc = Number(amount)
    const query = Number.isFinite(amountUsdc) && amountUsdc > 0 ? `?amountUsdc=${amountUsdc}` : ""

    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/offramp/quote${query}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await res.json()
        if (!cancelled && res.ok) setQuote(data)
      } catch {
        // A missing quote only hides the preview; the amount field still works.
      }
    }, 350)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [amount, token])

  const amountUsdc = Number(amount)
  const minUsdc = quote?.minUsdc ?? 1
  const maxUsdc = quote?.maxUsdc ?? 1000
  const validAmount =
    Number.isFinite(amountUsdc) &&
    amountUsdc >= minUsdc &&
    amountUsdc <= maxUsdc &&
    (!usdc || amountUsdc <= Number(usdc.formatted))

  const busy = phase === "resolving" || phase === "approving" || phase === "locking" || phase === "settling"

  const destinationLabel =
    rail === "bank"
      ? `${banks.find((b) => b.code === bankCode)?.name ?? bankCode} •••${accountNumber.slice(-4)}`
      : `${countryCode}${phone}`

  const formatFiat = (value: number) =>
    quote
      ? `${quote.symbol}${value.toLocaleString(quote.locale, {
          minimumFractionDigits: quote.decimals,
          maximumFractionDigits: quote.decimals,
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
            <h1 className="text-2xl font-black tracking-tight">Transfer sent</h1>
            <p className="text-sm text-black/50">
              {amount} USDC to {destinationLabel} ·{" "}
              {RAILS.find((r) => r.id === rail)?.label}
            </p>
            {result.fiatAmount !== undefined && (
              <p className="text-lg font-black tabular-nums pt-1">
                {formatFiat(result.fiatAmount)}
              </p>
            )}
          </div>

          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-left">
            <p className="text-[11px] leading-relaxed text-amber-900">
              <span className="font-bold">What actually happened:</span> the lock and the
              PancakeSwap swap are real on BSC Testnet — check them on BscScan. The rupiah
              conversion and the e-wallet payout are <span className="font-bold">simulated</span>;
              no real money reached that number.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            {result.settleTxHash && (
              <a
                href={explorerTxUrl(result.settleTxHash)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-amber-700 hover:underline"
              >
                Swap transaction <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {lockTxHash && (
              <a
                href={explorerTxUrl(lockTxHash)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-black/40 hover:underline"
              >
                Lock transaction <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

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

  if (phase === "needs-refund" && result) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-sm text-center space-y-5">
          <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto">
            <RotateCcw className="w-8 h-8 text-amber-600" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-xl font-black tracking-tight">Not settled</h1>
            <p className="text-sm text-black/50">
              Your {amount} USDC is locked in the escrow and the swap did not go through. Nothing
              is lost — you can claim it back once the rate lock expires.
            </p>
          </div>
          {result.refundableAfter && (
            <p className="text-xs text-black/40">
              Refundable after {new Date(result.refundableAfter).toLocaleTimeString()}
            </p>
          )}
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <button
            onClick={() => requestRefund(result.requestId)}
            className="w-full py-4 bg-black text-white rounded-2xl font-bold active:scale-[0.98] transition-transform"
          >
            Claim refund
          </button>
          <button
            onClick={() => router.push("/home")}
            className="w-full py-3 text-sm font-semibold text-black/45"
          >
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-white font-sans">
      <div className="max-w-lg mx-auto px-5 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => (step === "review" ? setStep("form") : router.push("/home"))}
            aria-label="Back"
            className="p-2 -ml-2 rounded-full hover:bg-black/5 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-black tracking-tight">Send to e-wallet</h1>
        </div>

        {status !== "connected" ? (
          <div className="p-5 rounded-3xl bg-amber-50 border border-amber-200 flex items-start gap-3">
            <Wallet className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-bold text-amber-900">Wallet not ready</p>
              <p className="text-xs text-amber-800">Finish setting up your wallet from Home first.</p>
            </div>
          </div>
        ) : step === "form" ? (
          <>
            <div className="rounded-2xl border border-black/8 bg-[#FAFAFA] px-4 py-3 flex items-baseline justify-between">
              <span className="text-sm font-medium text-black/45">Balance</span>
              <span className="text-lg font-black tabular-nums">{usdc?.formatted ?? "0"} USDC</span>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-black/45">
                  Destination
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {RAILS.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setRail(r.id)}
                      className={`py-2.5 rounded-xl text-xs font-bold border transition-all ${
                        rail === r.id
                          ? "border-black bg-black text-white"
                          : "border-black/10 hover:border-black/25"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {rail === "bank" ? (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-black/45">
                    Bank
                  </label>
                  <select
                    value={bankCode}
                    onChange={(e) => setBankCode(e.target.value)}
                    disabled={loadingBanks}
                    className="w-full px-4 py-4 bg-[#FAFAFA] border-2 border-transparent rounded-2xl text-base font-bold focus:border-black outline-none transition-all disabled:opacity-50 appearance-none"
                  >
                    <option value="">{loadingBanks ? "Loading banks…" : "Select a bank"}</option>
                    {banks.map((b) => (
                      <option key={b.code} value={b.code}>{b.name}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
                    placeholder="Account number"
                    className="w-full px-4 py-4 bg-[#FAFAFA] border-2 border-transparent rounded-2xl text-lg font-bold focus:border-black outline-none transition-all"
                  />
                  <p className="text-[11px] text-black/40">
                    They don&apos;t need Saku or a crypto wallet.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-black/45">
                    Recipient number
                  </label>
                  <div className="relative">
                    <CountryCodeDropdown onSelect={setCountryCode} selectedCode={countryCode} />
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                      placeholder="812 3456 7890"
                      className="w-full pl-28 pr-4 py-4 bg-[#FAFAFA] border-2 border-transparent rounded-2xl text-lg font-bold focus:border-black outline-none transition-all"
                    />
                  </div>
                  <p className="text-[11px] text-black/40">
                    They don&apos;t need Saku or a crypto wallet.
                  </p>
                </div>
              )}

              <div className="rounded-3xl border border-black/8 bg-[#FAFAFA] px-5 py-6 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-black/35">
                  Amount to send
                </p>
                <div className="mt-3 flex items-center justify-center gap-2">
                  <input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                    placeholder="0"
                    className="w-full max-w-[180px] bg-transparent outline-none text-center text-5xl font-black tabular-nums placeholder:text-black/15"
                  />
                  <span className="text-xl font-bold text-black/35">USDC</span>
                </div>
                <p className="mt-4 text-sm font-semibold text-black/50">
                  They receive{" "}
                  {validAmount && quote?.fiatAmount !== undefined
                    ? formatFiat(quote.fiatAmount)
                    : "—"}
                </p>
                {quote && (
                  <>
                    {quote.feeUsdc !== undefined && validAmount && (
                      <p className="mt-2 text-[11px] text-black/45">
                        Fee {quote.feeUsdc} USDC ({((quote.feeBps ?? 0) / 100).toFixed(2)}%) ·
                        {" "}{quote.netUsdc} USDC converted
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-black/35">
                      via PancakeSwap · rate {formatFiat(quote.fxRate)} / USDC
                      {quote.fxSource === "fallback" && " (approx.)"}
                    </p>
                  </>
                )}
              </div>

              {usdc && amountUsdc > Number(usdc.formatted) && (
                <p className="text-xs font-medium text-red-600">Not enough balance.</p>
              )}
              {error && <p className="text-sm font-medium text-red-600">{error}</p>}

              <button
                onClick={async () => {
                  const hash =
                    rail === "bank"
                      ? await resolveRecipient(rail, { bankCode, accountNumber })
                      : await resolveRecipient(rail, { phone, countryCode: countryCode.replace("+", "") })
                  if (hash) setStep("review")
                }}
                disabled={
                  (rail === "bank" ? !bankCode || accountNumber.length < 4 : phone.length < 8) ||
                  !validAmount ||
                  busy
                }
                className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-lg disabled:opacity-25 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                {phase === "resolving" && <Loader2 className="w-4 h-4 animate-spin" />}
                {phase === "resolving" ? "Checking…" : "Review"}
              </button>
            </div>
          </>
        ) : (
          <div className="rounded-3xl border border-black/8 p-5 space-y-5 animate-in slide-in-from-bottom-2 duration-200">
            <div className="text-center py-2">
              <p className="text-xs font-bold uppercase tracking-widest text-black/40">Sending</p>
              <p className="text-4xl font-black tabular-nums mt-1">{amount}</p>
              <p className="text-sm font-bold text-black/45">USDC</p>
            </div>

            <div className="space-y-3 pt-4 border-t border-black/5">
              <div className="flex justify-between text-sm">
                <span className="text-black/45">To</span>
                <span className="font-bold">{destinationLabel}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-black/45">Via</span>
                <span className="font-bold">{RAILS.find((r) => r.id === rail)?.label}</span>
              </div>
              {quote?.feeUsdc !== undefined && (
                <div className="flex justify-between text-sm">
                  <span className="text-black/45">Fee</span>
                  <span className="font-bold">{quote.feeUsdc} USDC</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-black/45">They receive</span>
                <span className="font-bold">
                  {quote?.fiatAmount !== undefined ? formatFiat(quote.fiatAmount) : "—"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-black/45">Rate locked for</span>
                <span className="font-bold">{quote?.rateExpirySeconds ?? 120}s</span>
              </div>
            </div>

            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3.5">
              <p className="text-[11px] leading-relaxed text-amber-900">
                The on-chain lock and swap are real. The rupiah conversion and e-wallet payout are{" "}
                <span className="font-bold">simulated</span> — Saku is a wallet interface, not a
                licensed payment provider.
              </p>
            </div>

            {error && <p className="text-sm font-medium text-red-600">{error}</p>}

            <button
              onClick={() => recipientHash && void send(amount, rail, recipientHash)}
              disabled={busy || !recipientHash}
              className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-lg disabled:opacity-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {phase === "approving" && "Approving escrow…"}
              {phase === "locking" && "Locking funds…"}
              {phase === "settling" && "Swapping & sending…"}
              {!busy && "Confirm & Send"}
            </button>
            <p className="text-[11px] text-center text-black/40">
              Two signatures on your device: an approval, then the lock.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

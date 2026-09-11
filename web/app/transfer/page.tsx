"use client"

/**
 * Transfer to another Saku user, by phone number.
 *
 * Four steps, as in v1: who, how much, confirm, done. What changed underneath is where the
 * signature comes from — v1 had the server decrypt a stored private key and sign; here the
 * user's device signs through the MPC layer and the server only ever sees the resulting hash.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { parseUnits } from "ethers"
import { ArrowLeft, ArrowLeftRight, ExternalLink, Loader2, Receipt, Smartphone, Wallet } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useMpcWallet } from "@/hooks/useMpcWallet"
import { useTokenBalances } from "@/hooks/useTokenBalances"
import { useTransfer } from "@/hooks/useTransfer"
import ProfileAvatar from "@/components/ui/profile-avatar"
import SakuCelebration from "@/components/ui/saku-celebration"
import { useCurrencyToggleAmount } from "@/hooks/useCurrencyToggleAmount"
import { type SakuTransaction } from "@/hooks/useTransactions"
import { formatUsdc, transferFee } from "@/lib/fees"
import { CONTRACTS, explorerTxUrl } from "@/lib/config"
import CountryCodeDropdown from "@/components/get-started/country-code-dropdown"
import ContactPicker from "@/components/shared/contact-picker"
import ReceiptModal from "@/components/transactions/receipt-modal"
import { rememberRecentPhone } from "@/lib/recent-recipients"
import { formatCurrency } from "@/lib/currency"
import { useRecipientCountryCode } from "@/hooks/useRecipientCountryCode"

type Step = "receiver" | "amount" | "review"

export default function TransferPage() {
  const router = useRouter()
  const { user, wallet, isLoading, isAuthenticated } = useAuth()
  const { address, status } = useMpcWallet()
  const { phase, recipient, txHash, error, resolveRecipient, send, reset } = useTransfer()

  const [step, setStep] = useState<Step>("receiver")
  // v1 split "Transfer" and "Withdraw" into separate menu items, which asks the user to know
  // whether their recipient has Saku before they can pick a screen. They usually do not — so
  // the destination is a choice inside one flow, and the e-wallet path hands off to /offramp.
  const [destination, setDestination] = useState<"saku" | "ewallet">("saku")
  const [countryCode, setCountryCode] = useRecipientCountryCode()
  const [phone, setPhone] = useState("")
  const amountField = useCurrencyToggleAmount(isAuthenticated)
  const amount = amountField.amountUsdc
  const [showReceipt, setShowReceipt] = useState(false)

  const walletAddress = address ?? wallet?.address ?? null
  const { balances, refresh } = useTokenBalances(walletAddress)
  const usdc = balances.find((t) => t.address.toLowerCase() === CONTRACTS.USDC.toLowerCase())

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/get-started")
  }, [isLoading, isAuthenticated, router])

  useEffect(() => {
    if (phase !== "done") return
    void refresh()
    if (phone.length >= 8) rememberRecentPhone(user?.phone_hash, { countryCode, phone })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, refresh])

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-black border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return null

  if (phase === "done") {
    const receiptTx: SakuTransaction | null = txHash
      ? {
          txHash,
          type: "transfer",
          status: "confirmed",
          amount: parseUnits(amount || "0", 6).toString(),
          tokenAddress: CONTRACTS.USDC,
          occurredAt: new Date().toISOString(),
          direction: "out",
          fromAddress: walletAddress,
          toAddress: recipient?.address ?? null,
          // Already resolved by `useTransfer` — no reason to make the receipt wait for a
          // /api/transactions round-trip to learn the name it was just sent to.
          counterpartyName: recipient?.displayName ?? null,
          counterpartyIsUser: true,
          context: null,
          feeAmount: parseUnits(
            transferFee(Number(amount || 0)).feeUsdc.toFixed(6),
            6
          ).toString(),
        }
      : null

    return (
      <div className="min-h-dvh bg-white flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-sm text-center space-y-6 animate-in zoom-in-95 duration-300">
          {/* Saku, rather than the emerald tick this used to end on — which was the same mark a
              form shows for a valid email address, put on the best moment in a wallet. */}
          <SakuCelebration />
          <div className="space-y-1">
            <h1 className="text-2xl font-black tracking-tight">Transfer sent</h1>
            <p className="text-sm text-black/45">
              {amount} USDC to {recipient?.displayName || `${countryCode}${phone}`}
            </p>
          </div>

          {txHash && (
            <a
              href={explorerTxUrl(txHash)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 text-xs font-semibold text-amber-700 hover:underline"
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
              className="w-full py-4 bg-black text-white rounded-2xl font-bold active:scale-[0.98] transition-all"
            >
              Back to Home
            </button>
          </div>
        </div>

        {showReceipt && receiptTx && <ReceiptModal transaction={receiptTx} onClose={() => setShowReceipt(false)} />}
      </div>
    )
  }

  const goBack = () => {
    if (step === "review") return setStep("amount")
    if (step === "amount") {
      reset()
      return setStep("receiver")
    }
    router.push("/home")
  }

  const validAmount =
    Number(amount) > 0 && (!usdc || Number(amount) <= Number(usdc.formatted))

  return (
    <div className="min-h-dvh bg-white font-sans">
      <div className="max-w-lg mx-auto px-5 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={goBack} aria-label="Back" className="p-2 -ml-2 rounded-full hover:bg-black/5 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-black tracking-tight">Transfer</h1>
        </div>

        {status !== "connected" ? (
          <div className="p-5 rounded-3xl bg-amber-50 border border-amber-200">
            <p className="text-sm font-bold text-amber-900">Wallet not ready</p>
            <p className="text-xs text-amber-800 mt-1">Finish setting up your wallet from the Home screen first.</p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-black/8 bg-[#FAFAFA] px-4 py-3 flex items-baseline justify-between">
              <span className="text-sm font-medium text-black/45">Balance</span>
              <span className="text-lg font-black tabular-nums">{usdc?.formatted ?? "0"} USDC</span>
            </div>

            {step === "receiver" && (
              <div className="rounded-3xl border border-black/8 p-5 space-y-5 animate-in slide-in-from-bottom-2 duration-200">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-black/45">
                    Send to
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setDestination("saku")}
                      className={`flex items-center justify-center gap-2 py-3 rounded-2xl text-xs font-bold border transition-all ${
                        destination === "saku"
                          ? "border-black bg-black text-white"
                          : "border-black/10 hover:border-black/25"
                      }`}
                    >
                      <Wallet className="w-4 h-4" /> Saku user
                    </button>
                    <button
                      onClick={() => {
                        setDestination("ewallet")
                        router.push("/offramp")
                      }}
                      className={`flex items-center justify-center gap-2 py-3 rounded-2xl text-xs font-bold border transition-all ${
                        destination === "ewallet"
                          ? "border-black bg-black text-white"
                          : "border-black/10 hover:border-black/25"
                      }`}
                    >
                      <Smartphone className="w-4 h-4" /> E-wallet
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-black/45">
                    Recipient number
                  </label>
                  <ContactPicker onPick={(cc, ph) => { setCountryCode(cc); setPhone(ph) }} />
                  <div className="relative">
                    <CountryCodeDropdown onSelect={setCountryCode} selectedCode={countryCode} />
                    <input
                      type="tel"
                      value={phone}
                      autoFocus
                      onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                      placeholder="812 3456 7890"
                      className="w-full pl-28 pr-4 py-4 bg-[#FAFAFA] border-2 border-transparent rounded-2xl text-lg font-bold focus:border-black outline-none transition-all"
                    />
                  </div>
                </div>

                {error && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-red-600">{error}</p>
                    {/^That number is not on Saku/.test(error) && (
                      <button
                        onClick={() => router.push("/offramp")}
                        className="w-full py-3 rounded-2xl border-2 border-black/12 text-sm font-bold hover:border-black/30 transition-colors"
                      >
                        Send to their e-wallet instead
                      </button>
                    )}
                  </div>
                )}

                <button
                  onClick={async () => {
                    const found = await resolveRecipient(phone, countryCode.replace("+", ""))
                    if (found) setStep("amount")
                  }}
                  disabled={phone.length < 8 || phase === "resolving"}
                  className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-lg disabled:opacity-30 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  {phase === "resolving" && <Loader2 className="w-4 h-4 animate-spin" />}
                  {phase === "resolving" ? "Looking up…" : "Continue"}
                </button>
              </div>
            )}

            {step === "amount" && recipient && (
              <div className="rounded-3xl border border-black/8 p-5 space-y-5 animate-in slide-in-from-bottom-2 duration-200">
                <div className="flex items-center gap-3 p-3 rounded-2xl bg-[#FAFAFA]">
                  {/* Their own picture. Seeing the face you expect is the cheapest check there
                      is against a mistyped digit sending money to a stranger. */}
                  <ProfileAvatar src={recipient.avatarUrl} name={recipient.displayName} className="w-10 h-10" textClassName="text-xs" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{recipient.displayName || "Saku user"}</p>
                    <p className="text-xs text-black/45 font-mono truncate">
                      {recipient.address.slice(0, 6)}…{recipient.address.slice(-4)}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-black/45">Amount</label>
                  <div className="flex items-center gap-2 border-2 border-transparent focus-within:border-black rounded-2xl bg-[#F9EFE5] px-4 py-3 transition-all">
                    <input
                      inputMode="decimal"
                      value={amountField.displayValue}
                      autoFocus
                      onChange={(e) => amountField.setDisplayValue(e.target.value)}
                      placeholder="0.00"
                      className="flex-1 bg-transparent outline-none text-2xl font-black tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={amountField.toggleUnit}
                      disabled={!amountField.currency}
                      className="flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-full bg-black/[0.06] hover:bg-black/10 active:scale-95 transition-all disabled:opacity-40 disabled:active:scale-100"
                    >
                      <ArrowLeftRight className="w-3 h-3 text-black/40" />
                      <span className="text-sm font-black text-black/70">{amountField.unitLabel}</span>
                    </button>
                  </div>
                  {amountField.currency && Number(amount) > 0 && (
                    <p className="text-xs font-semibold text-black/40">
                      ≈{" "}
                      {amountField.unit === "usdc"
                        ? formatCurrency(Number(amount) * amountField.currency.fxRate, amountField.currency)
                        : `${amount} USDC`}
                    </p>
                  )}
                  {Number(amount) > Number(usdc?.formatted ?? 0) && (
                    <p className="text-xs font-medium text-red-600">Not enough balance.</p>
                  )}
                </div>

                <button
                  onClick={() => setStep("review")}
                  disabled={!validAmount}
                  className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-lg disabled:opacity-30 active:scale-[0.98] transition-all"
                >
                  Review
                </button>
              </div>
            )}

            {step === "review" && recipient && (
              <div className="rounded-3xl border border-black/8 p-5 space-y-5 animate-in slide-in-from-bottom-2 duration-200">
                <div className="text-center py-2">
                  <p className="text-xs font-bold uppercase tracking-widest text-black/45">Send</p>
                  <p className="text-4xl font-black tabular-nums mt-1">{amount}</p>
                  <p className="text-sm font-bold text-black/45">USDC</p>
                </div>

                <div className="space-y-3 pt-4 border-t border-black/5">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-black/45">To</span>
                    <span className="flex items-center gap-2 min-w-0">
                      <ProfileAvatar src={recipient.avatarUrl} name={recipient.displayName} className="w-6 h-6" textClassName="text-[9px]" />
                      <span className="font-bold truncate">{recipient.displayName || "Saku user"}</span>
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-black/45">Number</span>
                    <span className="font-bold">{countryCode}{phone}</span>
                  </div>
                  {/* Shown before signing, not only on the receipt. A fee the user first meets
                      after paying is a fee designed not to be noticed. */}
                  <div className="pt-3 mt-1 border-t border-black/5 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-black/45">They receive</span>
                      <span className="font-bold tabular-nums">{formatUsdc(Number(amount || 0))} USDC</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-black/45">
                        Platform fee ({(transferFee(1).bps / 100).toFixed(2)}%)
                      </span>
                      <span className="font-bold tabular-nums">
                        +{formatUsdc(transferFee(Number(amount || 0)).feeUsdc)} USDC
                      </span>
                    </div>
                    <div className="flex justify-between text-sm pt-1 border-t border-black/5">
                      <span className="font-bold">You pay</span>
                      <span className="font-black tabular-nums">
                        {formatUsdc(transferFee(Number(amount || 0)).grossUsdc)} USDC
                      </span>
                    </div>
                  </div>
                </div>

                {error && <p className="text-sm font-medium text-red-600">{error}</p>}

                <button
                  onClick={() => send(recipient.address, amount)}
                  disabled={phase === "sending"}
                  className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-lg disabled:opacity-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  {phase === "sending" && <Loader2 className="w-4 h-4 animate-spin" />}
                  {phase === "sending" ? "Signing & sending…" : "Confirm & Send"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

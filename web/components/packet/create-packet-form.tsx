"use client"

/**
 * Fund and send a packet — the "Create" tab of `/packet`.
 *
 * The confirmation states the custody trade-off plainly: funding a packet means handing the
 * amount to Saku until someone claims it, which is the one place v2 holds a user's money. Every
 * other flow leaves funds under the user's own key, and a screen that quietly blurs the two
 * would be the wrong place to save a sentence.
 *
 * A **private circle** restricts the packet to chosen contacts, stored as phone hashes. That is
 * what makes a packet reach anyone at all without a link changing hands — those people find it
 * waiting in their own app (`/api/packet/invited`). Inviting more people than there are slots is
 * the point of the mode: it is a race.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowLeftRight, Check, Copy, Gift, Loader2, Lock, Wallet } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useMpcWallet } from "@/hooks/useMpcWallet"
import { useTokenBalances } from "@/hooks/useTokenBalances"
import { useCreatePacket } from "@/hooks/usePacket"
import { useCurrencyToggleAmount } from "@/hooks/useCurrencyToggleAmount"
import { formatLocal } from "@/hooks/useLocalCurrency"
import { PACKET_THEMES, type PacketTheme } from "@/lib/packet-themes"
import PacketTypeSelector from "@/components/packet/packet-type-selector"
import PacketEnvelope from "@/components/packet/packet-envelope"
import PacketLetter from "@/components/packet/packet-letter"
import ContactCircle from "@/components/packet/contact-circle"
import { CONTRACTS } from "@/lib/config"
import { formatUsdc, transferFee } from "@/lib/fees"

const MAX_SLOTS = 100

/** Mirrors `EXPIRY_CHOICES` in `/api/packet/create`, which rejects anything else. */
const EXPIRY_OPTIONS: { hours: number | null; label: string }[] = [
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "1 week" },
  { hours: 720, label: "30 days" },
  { hours: null, label: "Never" },
]

export default function CreatePacketForm({ onCreated }: { onCreated?: () => void }) {
  const router = useRouter()
  const { user, wallet, isLoading, isAuthenticated } = useAuth()
  const { address, status } = useMpcWallet()
  const { phase, error, packet, create, reset, clearError } = useCreatePacket()

  // The amount can be typed in USDC or in the currency of the number the user signed up with —
  // "50.000" is how someone in Indonesia thinks about a packet, not "3.07".
  const money = useCurrencyToggleAmount(isAuthenticated)
  const amount = money.amountUsdc

  const [slots, setSlots] = useState("1")
  const [splitMode, setSplitMode] = useState<"equal" | "random">("equal")
  const [theme, setTheme] = useState<PacketTheme>(PACKET_THEMES[0])
  const [message, setMessage] = useState("")
  const [expiresInHours, setExpiresInHours] = useState<number | null>(72)
  const [isPrivate, setIsPrivate] = useState(false)
  const [circle, setCircle] = useState<string[]>([])
  const [copied, setCopied] = useState(false)

  const walletAddress = address ?? wallet?.address ?? null
  const { balances, refresh } = useTokenBalances(walletAddress)
  const usdc = balances.find((t) => t.address.toLowerCase() === CONTRACTS.USDC.toLowerCase())

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/get-started")
  }, [isLoading, isAuthenticated, router])

  useEffect(() => {
    if (phase === "done") void refresh()
  }, [phase, refresh])

  const amountNum = Number(amount)
  const slotsNum = Number(slots)
  const validSlots = Number.isInteger(slotsNum) && slotsNum >= 1 && slotsNum <= MAX_SLOTS
  // Checked against the total including the fee, since that is what leaves the wallet.
  const totalWithFee = transferFee(Number.isFinite(amountNum) ? amountNum : 0).grossUsdc
  const validAmount =
    Number.isFinite(amountNum) && amountNum > 0 && (!usdc || totalWithFee <= Number(usdc.formatted))
  // A private packet with nobody in the circle would be funded and unopenable until it expires.
  const validCircle = !isPrivate || circle.length > 0
  const busy = phase === "funding" || phase === "creating"

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-black/20" />
      </div>
    )
  }

  if (!user) return null

  if (phase === "done" && packet) {
    const link = `${window.location.origin}/packet/claim/${packet.code}`
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-sm text-center space-y-6 animate-in zoom-in-95 duration-300">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
            <Gift className="w-8 h-8 text-red-500" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-2xl font-black tracking-tight">Packet ready</h1>
            <p className="text-sm text-black/50">
              {packet.totalAmount} USDC · {packet.slots} {packet.slots === 1 ? "slot" : "slots"}
              {circle.length > 0 && ` · ${circle.length} invited`}
            </p>
          </div>

          <div className="rounded-2xl border border-black/8 bg-[#FAFAFA] p-4 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-black/35">Code</p>
            <p className="text-2xl font-black tracking-[0.2em] font-mono">{packet.code}</p>
          </div>

          <button
            onClick={async () => {
              await navigator.clipboard.writeText(link)
              setCopied(true)
              setTimeout(() => setCopied(false), 1800)
            }}
            className="w-full py-3.5 rounded-2xl border-2 border-black/10 font-bold text-sm flex items-center justify-center gap-2 hover:border-black/25 transition-colors"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? "Link copied" : "Copy claim link"}
          </button>

          <p className="text-[11px] text-black/40">
            {packet.expiresAt
              ? `Unclaimed slots expire ${new Date(packet.expiresAt).toLocaleString()}.`
              : "This packet has no deadline."}
          </p>

          <button
            onClick={() => {
              reset()
              if (onCreated) onCreated()
              else router.push("/home")
            }}
            className="w-full py-4 bg-black text-white rounded-2xl font-bold active:scale-[0.98] transition-transform"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <>
        {status !== "connected" ? (
          <div className="p-5 rounded-3xl bg-amber-50 border border-amber-200 flex items-start gap-3">
            <Wallet className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-bold text-amber-900">Wallet not ready</p>
              <p className="text-xs text-amber-800">Finish setting up your wallet from Home first.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-black/8 bg-[#FAFAFA] px-4 py-3 flex items-baseline justify-between">
              <span className="text-sm font-medium text-black/45">Balance</span>
              <span className="text-lg font-black tabular-nums">{usdc?.formatted ?? "0"} USDC</span>
            </div>

            <div className="rounded-3xl border border-black/8 bg-[#FAFAFA] px-5 py-6 text-center">
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-black/35">
                Total amount
              </p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <input
                  inputMode="decimal"
                  value={money.displayValue}
                  autoFocus
                  onChange={(e) => {
                    money.setDisplayValue(e.target.value)
                    clearError()
                  }}
                  placeholder="0"
                  disabled={busy}
                  className="w-full max-w-[190px] bg-transparent outline-none text-center text-5xl font-black tabular-nums placeholder:text-black/15 disabled:opacity-50"
                />
                <span className="text-xl font-bold text-black/35">{money.unitLabel}</span>
              </div>

              {money.currency && (
                <div className="mt-3 flex items-center justify-center gap-2">
                  <p className="text-xs font-semibold text-black/40 tabular-nums">
                    {money.unit === "usdc"
                      ? (formatLocal(Number(amount || 0), money.currency) ?? "")
                      : `${formatUsdc(Number(amount || 0))} USDC`}
                  </p>
                  <button
                    type="button"
                    onClick={money.toggleUnit}
                    disabled={busy}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/[0.06] text-[10px] font-bold uppercase tracking-widest text-black/55 hover:bg-black/10 transition-colors disabled:opacity-40"
                  >
                    <ArrowLeftRight className="w-3 h-3" />
                    {money.unit === "usdc" ? money.currency.code : "USDC"}
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-black/45">
                  Slots
                </label>
                <input
                  inputMode="numeric"
                  value={slots}
                  onChange={(e) => {
                    setSlots(e.target.value.replace(/\D/g, "").slice(0, 3))
                    clearError()
                  }}
                  disabled={busy}
                  className="w-full px-4 py-3 bg-[#FAFAFA] border-2 border-transparent rounded-2xl text-sm font-bold focus:border-black outline-none transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-black/45">
                  Split
                </label>
                <div className="flex gap-1.5">
                  {(["equal", "random"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setSplitMode(mode)}
                      disabled={busy}
                      className={`flex-1 py-3 rounded-2xl text-xs font-bold border transition-all capitalize ${
                        splitMode === mode
                          ? "border-black bg-black text-white"
                          : "border-black/10 hover:border-black/25"
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-black/45">
                Expires
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                {EXPIRY_OPTIONS.map((option) => {
                  const selected = expiresInHours === option.hours
                  return (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => setExpiresInHours(option.hours)}
                      disabled={busy}
                      className={`py-2.5 rounded-xl text-[11px] font-bold border transition-all ${
                        selected ? "border-black bg-black text-white" : "border-black/10 hover:border-black/25"
                      }`}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-black/35">
                {expiresInHours === null
                  ? "Unclaimed slots stay open until someone takes them."
                  : "Unclaimed slots close after this, and nobody can open it."}
              </p>
            </div>

            {/* What the recipient will actually open. Live, so picking a style is a decision made
                against the real thing rather than a 100px swatch. */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-black/45">Preview</p>
              <div className="max-w-[17rem] mx-auto">
                <PacketEnvelope
                  theme={theme}
                  size="lg"
                  letter={
                    message.trim() ? (
                      <PacketLetter text={message.trim()} from={user.display_name} compact />
                    ) : undefined
                  }
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-70">
                    {splitMode === "random" ? "Random split" : "Equal split"}
                  </p>
                  <p className="text-3xl font-black tabular-nums drop-shadow-sm">
                    {amountNum > 0 ? amountNum.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0"}
                  </p>
                  <p className="text-xs font-bold opacity-80">
                    USDC · {slotsNum || 1} {slotsNum === 1 ? "slot" : "slots"}
                  </p>
                </PacketEnvelope>
              </div>
            </div>

            <PacketTypeSelector selectedTheme={theme} onSelectTheme={setTheme} />

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <label className="text-[10px] font-bold uppercase tracking-widest text-black/45">
                  Your letter
                </label>
                <span className="text-[10px] tabular-nums text-black/30">{message.length}/600</span>
              </div>
              {/* Room to actually write. 140 characters was a caption; this is the note that comes
                  out of the envelope with the money, and 600 is the column's cap after the
                  2026-09-09 migration. */}
              <textarea
                value={message}
                maxLength={600}
                rows={5}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={"Happy birthday!\nHope this year treats you well.\n\nLove, me"}
                disabled={busy}
                className="w-full px-4 py-3 bg-[#FAFAFA] border-2 border-transparent rounded-2xl text-sm font-semibold leading-relaxed resize-none focus:border-black outline-none transition-all"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 rounded-2xl bg-[#FAFAFA] border border-black/[0.07]">
                <div className="flex items-center gap-3 min-w-0">
                  <Lock className="w-4 h-4 text-black/45 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold">Private circle</p>
                    <p className="text-[11px] text-black/40">
                      Only the contacts you pick can open it — no link needed.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isPrivate}
                  aria-label="Private circle"
                  onClick={() => setIsPrivate((v) => !v)}
                  disabled={busy}
                  className={`relative w-11 h-6 rounded-full shrink-0 transition-colors disabled:opacity-40 ${
                    isPrivate ? "bg-black" : "bg-black/15"
                  }`}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${
                      isPrivate ? "left-6" : "left-1"
                    }`}
                  />
                </button>
              </div>

              <AnimatePresence initial={false}>
                {isPrivate && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <ContactCircle
                      selected={circle}
                      onChange={setCircle}
                      slots={slotsNum || 1}
                      disabled={busy}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="rounded-2xl border border-black/8 bg-[#FAFAFA] px-4 py-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-black/45">Goes in the packet</span>
                <span className="font-bold tabular-nums">{formatUsdc(amountNum)} USDC</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-black/45">
                  Platform fee ({(transferFee(1).bps / 100).toFixed(2)}%)
                </span>
                <span className="font-bold tabular-nums">
                  +{formatUsdc(transferFee(amountNum).feeUsdc)} USDC
                </span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t border-black/5">
                <span className="font-bold">You pay</span>
                <span className="font-black tabular-nums">
                  {formatUsdc(transferFee(amountNum).grossUsdc)} USDC
                </span>
              </div>
            </div>

            {/* The one flow where Saku holds the money. Worth a line; not worth a paragraph. */}
            <p className="text-[11px] text-center text-amber-700">
              Saku holds this until someone claims it.
            </p>

            {usdc && totalWithFee > Number(usdc.formatted) && (
              <p className="text-xs font-medium text-red-600">Not enough balance.</p>
            )}
            {error && <p className="text-sm font-medium text-red-600">{error}</p>}

            <button
              onClick={() =>
                create({
                  amount,
                  slots: slotsNum,
                  splitMode,
                  theme: theme.id,
                  message: message.trim() || undefined,
                  expiresInHours,
                  restrictedToHashes: isPrivate && circle.length > 0 ? circle : undefined,
                })
              }
              disabled={busy || !validAmount || !validSlots || !validCircle}
              className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-lg disabled:opacity-25 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {phase === "funding" && "Funding packet…"}
              {phase === "creating" && "Creating…"}
              {!busy && "Create packet"}
            </button>
          </>
        )}
      </>
    </div>
  )
}

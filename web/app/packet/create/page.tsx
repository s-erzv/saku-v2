"use client"

/**
 * Create a packet — the red-envelope flow from v1.
 *
 * The confirmation states the custody trade-off plainly: funding a packet means handing the
 * amount to Saku until someone claims it, which is the one place v2 holds a user's money. Every
 * other flow leaves funds under the user's own key, and a screen that quietly blurs the two
 * would be the wrong place to save a sentence.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Check, Copy, Gift, Loader2, Wallet } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useMpcWallet } from "@/hooks/useMpcWallet"
import { useTokenBalances } from "@/hooks/useTokenBalances"
import { useCreatePacket } from "@/hooks/usePacket"
import { PACKET_THEMES, type PacketTheme } from "@/lib/packet-themes"
import PacketTypeSelector from "@/components/packet/packet-type-selector"
import { CONTRACTS } from "@/lib/config"

const MAX_SLOTS = 100

export default function CreatePacketPage() {
  const router = useRouter()
  const { user, wallet, isLoading, isAuthenticated } = useAuth()
  const { address, status } = useMpcWallet()
  const { phase, error, packet, create, reset } = useCreatePacket()

  const [amount, setAmount] = useState("")
  const [slots, setSlots] = useState("1")
  const [splitMode, setSplitMode] = useState<"equal" | "random">("equal")
  const [theme, setTheme] = useState<PacketTheme>(PACKET_THEMES[0])
  const [message, setMessage] = useState("")
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
  const validAmount =
    Number.isFinite(amountNum) && amountNum > 0 && (!usdc || amountNum <= Number(usdc.formatted))
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
            Unclaimed slots expire {new Date(packet.expiresAt).toLocaleString()}.
          </p>

          <button
            onClick={() => { reset(); router.push("/home") }}
            className="w-full py-4 bg-black text-white rounded-2xl font-bold active:scale-[0.98] transition-transform"
          >
            Done
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
            onClick={() => router.push("/home")}
            aria-label="Back"
            className="p-2 -ml-2 rounded-full hover:bg-black/5 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-black tracking-tight">Send a packet</h1>
        </div>

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
                  value={amount}
                  autoFocus
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder="0"
                  disabled={busy}
                  className="w-full max-w-[180px] bg-transparent outline-none text-center text-5xl font-black tabular-nums placeholder:text-black/15 disabled:opacity-50"
                />
                <span className="text-xl font-bold text-black/35">USDC</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-black/45">
                  Slots
                </label>
                <input
                  inputMode="numeric"
                  value={slots}
                  onChange={(e) => setSlots(e.target.value.replace(/\D/g, "").slice(0, 3))}
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

            <PacketTypeSelector selectedTheme={theme} onSelectTheme={setTheme} />

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-black/45">
                Message (optional)
              </label>
              <input
                value={message}
                maxLength={140}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Congrats!"
                disabled={busy}
                className="w-full px-4 py-3 bg-[#FAFAFA] border-2 border-transparent rounded-2xl text-sm font-semibold focus:border-black outline-none transition-all"
              />
            </div>

            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200">
              <p className="text-[11px] leading-relaxed text-amber-900">
                <span className="font-bold">Note:</span> funding a packet sends the amount to
                Saku, which holds it until someone claims. Every other Saku transfer stays under
                your own key — this one does not, and the funding transaction is on BscScan.
              </p>
            </div>

            {usdc && amountNum > Number(usdc.formatted) && (
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
                })
              }
              disabled={busy || !validAmount || !validSlots}
              className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-lg disabled:opacity-25 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {phase === "funding" && "Funding packet…"}
              {phase === "creating" && "Creating…"}
              {!busy && "Create packet"}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

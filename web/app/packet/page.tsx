"use client"

/**
 * Packets — send one, open one, see your own.
 *
 * v2 shipped with only the create half wired up: the claim screen existed at
 * `/packet/claim/[code]` but nothing in the app ever navigated there, so a packet could be
 * funded and then never opened by anyone who hadn't been handed the URL by hand. This is the
 * missing half, in the shape v1 had it.
 *
 * Three ways a packet reaches someone, and all three live here:
 *   - **Waiting for you** — a private-circle packet addressed to this number, which arrives with
 *     no link at all (`/api/packet/invited`).
 *   - **A code** — typed in, the way v1's receipt promised ("anyone with this QR or code").
 *   - **A link or QR** — straight to `/packet/claim/[code]`, unchanged.
 */

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { motion } from "framer-motion"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Gift,
  Loader2,
  Lock,
  PlusCircle,
  Ticket,
  Users2,
} from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useInvitedPackets, useMyPackets, type MyPacket } from "@/hooks/usePacket"
import { PACKET_THEMES } from "@/lib/packet-themes"
import { formatPacketAmount } from "@/lib/packet"
import CreatePacketForm from "@/components/packet/create-packet-form"
import BottomNavigation from "@/components/home/bottom-navigation"

type Tab = "create" | "claim" | "mine"

const TABS: { id: Tab; label: string; icon: typeof Gift }[] = [
  { id: "create", label: "Send", icon: PlusCircle },
  { id: "claim", label: "Open", icon: Ticket },
  { id: "mine", label: "Mine", icon: Users2 },
]

/** Codes are generated uppercase alphanumeric (`lib/packet.ts`); typing is forgiving about case. */
function normaliseCode(raw: string) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16)
}

function themeColor(themeId: string | null) {
  return (PACKET_THEMES.find((t) => t.id === themeId) ?? PACKET_THEMES[0]).colors
}

/** `null` expiry means the sender chose no deadline; it is a state, not a missing value. */
function expiryLabel(expiresAt: string | null) {
  if (!expiresAt) return "No deadline"
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return "Expired"
  const hours = Math.round(ms / 3_600_000)
  if (hours < 24) return `${hours}h left`
  return `${Math.round(hours / 24)}d left`
}

function statusChip(packet: MyPacket) {
  if (packet.status === "expired") return { label: "Expired", className: "bg-red-100 text-red-600" }
  if (packet.claimedCount >= packet.slots || Number(packet.remainingAmount) <= 0) {
    return { label: "All claimed", className: "bg-emerald-100 text-emerald-600" }
  }
  return { label: "Open", className: "bg-orange-100 text-[#F0A353]" }
}

function PacketHub() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, isLoading, isAuthenticated } = useAuth()

  const initialTab = (searchParams.get("tab") as Tab) ?? "create"
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.id === initialTab) ? initialTab : "create")
  const [code, setCode] = useState("")
  const [copied, setCopied] = useState<string | null>(null)
  const [openPacket, setOpenPacket] = useState<string | null>(null)

  const { packets: invited, isLoading: loadingInvited, refresh: refreshInvited } = useInvitedPackets()
  const { created, claimed, isLoading: loadingMine, refresh: refreshMine } = useMyPackets()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/get-started")
  }, [isLoading, isAuthenticated, router])

  async function copyLink(packetCode: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/packet/claim/${packetCode}`)
    setCopied(packetCode)
    setTimeout(() => setCopied(null), 1800)
  }

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-black/20" />
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-dvh bg-white font-sans max-w-lg mx-auto">
      <div className="px-5 py-6 space-y-5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/home")}
            aria-label="Back"
            className="p-2 -ml-2 rounded-full hover:bg-black/5 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-black tracking-tight">Packet</h1>
          {invited.length > 0 && tab !== "claim" && (
            <button
              onClick={() => setTab("claim")}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-orange-100 text-[#F0A353] text-[11px] font-bold"
            >
              <Gift className="w-3.5 h-3.5" />
              {invited.length} waiting
            </button>
          )}
        </div>

        <div className="flex p-1 bg-black/[0.04] rounded-2xl">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all ${
                tab === id ? "bg-white shadow-sm text-black" : "text-black/45 hover:text-black/70"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {tab === "create" && (
          <CreatePacketForm
            onCreated={() => {
              void refreshMine()
              setTab("mine")
            }}
          />
        )}

        {tab === "claim" && (
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-black/45">
                Have a code?
              </label>
              <div className="flex gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(normaliseCode(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && code.length >= 6) router.push(`/packet/claim/${code}`)
                  }}
                  placeholder="ABC12345"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 px-4 py-3.5 bg-[#FAFAFA] border-2 border-transparent rounded-2xl text-lg font-black tracking-[0.2em] font-mono uppercase placeholder:text-black/15 placeholder:tracking-[0.2em] focus:border-black outline-none transition-all"
                />
                <button
                  onClick={() => router.push(`/packet/claim/${code}`)}
                  disabled={code.length < 6}
                  aria-label="Open packet"
                  className="px-5 shrink-0 rounded-2xl bg-black text-white font-bold disabled:opacity-25 active:scale-95 transition-all"
                >
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
              <p className="text-[11px] text-black/35">
                The code on a packet&apos;s receipt, or scan its QR. A link works too.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between px-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-black/35">
                  Waiting for you
                </p>
                {invited.length > 0 && (
                  <p className="text-[10px] font-bold text-black/35">Fastest finger wins</p>
                )}
              </div>

              {loadingInvited && invited.length === 0 ? (
                <div className="py-10 flex justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-black/20" />
                </div>
              ) : invited.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <Gift className="w-8 h-8 mx-auto text-black/15" />
                  <p className="text-xs font-medium text-black/40">Nothing waiting right now</p>
                  <p className="text-[11px] text-black/30">
                    Packets sent to your number show up here without a link.
                  </p>
                </div>
              ) : (
                invited.map((packet, index) => {
                  const colors = themeColor(packet.theme)
                  return (
                    <motion.button
                      key={packet.code}
                      onClick={() => router.push(`/packet/claim/${packet.code}`)}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(index, 8) * 0.04 }}
                      className="w-full flex items-center gap-3 p-3.5 rounded-2xl border border-black/6 hover:bg-black/[0.02] transition-colors text-left"
                    >
                      <div
                        className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 text-white"
                        style={{ background: colors.envelopeBg }}
                      >
                        <Gift className="w-5 h-5 drop-shadow" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold truncate">
                          From {packet.fromName ?? "a Saku user"}
                        </p>
                        <p className="text-[11px] text-black/40 truncate">
                          {formatPacketAmount(packet.remainingAmount)} USDC left · {packet.claimedCount}/
                          {packet.slots} claimed
                        </p>
                      </div>
                      <span className="shrink-0 px-3 py-1.5 rounded-xl bg-black text-white text-[11px] font-bold">
                        Open
                      </span>
                    </motion.button>
                  )
                })
              )}
            </div>
          </div>
        )}

        {tab === "mine" && (
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-baseline justify-between px-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-black/35">
                  You sent
                </p>
                <button
                  onClick={() => {
                    void refreshMine()
                    void refreshInvited()
                  }}
                  className="text-[10px] font-bold text-black/35 hover:text-black/60 transition-colors"
                >
                  Refresh
                </button>
              </div>

              {loadingMine && created.length === 0 ? (
                <div className="py-10 flex justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-black/20" />
                </div>
              ) : created.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <Gift className="w-8 h-8 mx-auto text-black/15" />
                  <p className="text-xs font-medium text-black/40">No packets sent yet</p>
                </div>
              ) : (
                created.map((packet) => {
                  const chip = statusChip(packet)
                  const colors = themeColor(packet.theme)
                  const progress = Math.min(100, (packet.claimedCount / packet.slots) * 100)
                  const isOpen = openPacket === packet.code

                  return (
                    <div key={packet.code} className="rounded-2xl border border-black/6 p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <div
                          className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 text-white"
                          style={{ background: colors.envelopeBg }}
                        >
                          <Gift className="w-5 h-5 drop-shadow" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-black tabular-nums">
                            {formatPacketAmount(packet.totalAmount)} USDC
                          </p>
                          <p className="text-[11px] text-black/40">
                            {new Date(packet.createdAt).toLocaleDateString("en-US", {
                              day: "numeric",
                              month: "short",
                            })}
                            {" · "}
                            {packet.splitMode === "random" ? "Random" : "Equal"}
                            {packet.isPrivate && ` · ${packet.invitedCount} invited`}
                            {` · ${expiryLabel(packet.expiresAt)}`}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold ${chip.className}`}
                        >
                          {chip.label}
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-baseline justify-between text-[11px]">
                          <span className="text-black/40">
                            {packet.claimedCount} of {packet.slots} claimed
                          </span>
                          <span className="font-semibold tabular-nums text-black/55">
                            {formatPacketAmount(packet.remainingAmount)} left
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-black/[0.06] overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${progress}%` }}
                            transition={{ duration: 0.5 }}
                            className="h-full rounded-full"
                            style={{ backgroundColor: colors.primary }}
                          />
                        </div>
                      </div>

                      {/* Who opened it. The progress bar answers "how many"; a sender wants to
                          know which of their friends actually took it, and for how much. */}
                      {packet.claims.length > 0 && (
                        <div className="space-y-1">
                          <button
                            onClick={() => setOpenPacket(isOpen ? null : packet.code)}
                            className="w-full flex items-center gap-1.5 text-[11px] font-bold text-black/45 hover:text-black transition-colors"
                          >
                            <ChevronDown
                              className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
                            />
                            {isOpen ? "Hide" : "See"} who opened it
                          </button>

                          {isOpen &&
                            packet.claims.map((claim, i) => (
                              <div
                                key={`${packet.code}-${i}`}
                                className="flex items-center gap-2.5 pl-1 py-1"
                              >
                                <div className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 text-[10px] font-black">
                                  {(claim.name ?? "?").slice(0, 1).toUpperCase()}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-bold truncate">
                                    {claim.name ?? "A Saku user"}
                                  </p>
                                  <p className="text-[10px] text-black/35">
                                    {new Date(claim.claimedAt).toLocaleString("en-US", {
                                      day: "numeric",
                                      month: "short",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </p>
                                </div>
                                <p className="text-xs font-black tabular-nums text-emerald-600 shrink-0">
                                  {formatPacketAmount(claim.amount)}
                                </p>
                              </div>
                            ))}
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 rounded-xl bg-[#FAFAFA] border border-black/[0.06]">
                          {packet.isPrivate ? (
                            <Lock className="w-3 h-3 text-black/30 shrink-0" />
                          ) : (
                            <Ticket className="w-3 h-3 text-black/30 shrink-0" />
                          )}
                          <span className="text-xs font-black font-mono tracking-widest truncate">
                            {packet.code}
                          </span>
                        </div>
                        <button
                          onClick={() => copyLink(packet.code)}
                          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-black/[0.05] text-xs font-bold hover:bg-black/10 transition-colors"
                        >
                          {copied === packet.code ? (
                            <Check className="w-3.5 h-3.5" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          {copied === packet.code ? "Copied" : "Link"}
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {claimed.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-black/35 px-1">
                  You opened
                </p>
                {claimed.map((claim, index) => (
                  <div
                    key={`${claim.code}-${index}`}
                    className="flex items-center gap-3 p-3.5 rounded-2xl border border-black/6"
                  >
                    <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                      <Gift className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold font-mono tracking-wider truncate">
                        {claim.code ?? "Packet"}
                      </p>
                      <p className="text-[11px] text-black/40 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(claim.claimedAt).toLocaleDateString("en-US", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                    <p className="text-sm font-black tabular-nums text-emerald-600 shrink-0">
                      +{formatPacketAmount(claim.amount)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <BottomNavigation />
    </div>
  )
}

/** `useSearchParams` needs a Suspense boundary on an otherwise-prerendered route. */
export default function PacketPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-white flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-black/20" />
        </div>
      }
    >
      <PacketHub />
    </Suspense>
  )
}

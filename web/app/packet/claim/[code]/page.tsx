"use client"

/**
 * Open and claim a packet.
 *
 * The envelope stays closed until the claim resolves, which is the point of the interaction —
 * the amount is decided server-side at claim time (random mode draws from what is left), so
 * revealing it before the payout lands would be showing a number that is not yet true.
 *
 * The opening itself is one gesture: the flap lifts, the sender's note and the amount rise out
 * of the envelope, and confetti fires.
 */

import { use, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion"
import { ArrowLeft, ArrowLeftRight, ExternalLink, Gift, Loader2, Lock, Mail } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useClaimPacket } from "@/hooks/usePacket"
import { useLocalCurrency, formatLocal } from "@/hooks/useLocalCurrency"
import { PACKET_THEMES } from "@/lib/packet-themes"
import PacketEnvelope from "@/components/packet/packet-envelope"
import PacketLetter from "@/components/packet/packet-letter"
import { explorerTxUrl } from "@/lib/config"
import { EASE_RISE, openTimeline, type Beat } from "@/lib/packet-open-timeline"

/** Deterministic-ish burst: enough pieces to read as celebration, few enough to stay smooth. */
const CONFETTI = Array.from({ length: 28 }, (_, i) => ({
  id: i,
  x: (i % 7) * 16 - 48 + ((i * 37) % 13),
  delay: (i % 9) * 0.035,
  rotate: ((i * 53) % 360) - 180,
  hue: ["#F0A353", "#059669", "#e11d48", "#6366f1", "#fbbf24"][i % 5],
}))

function Confetti({ beat }: { beat: Beat }) {
  return (
    // `z-30` because it was not there, and without it none of this was ever visible. The
    // envelope's wrapper carries a transform, which makes it a stacking context, and this layer
    // is its DOM sibling with `z-auto` — so every piece was painted underneath an opaque
    // envelope and the burst only ever showed in the margins around it.
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden>
      {CONFETTI.map((piece) => (
        <motion.span
          key={piece.id}
          className="absolute left-1/2 top-[38%] block w-1.5 h-3 rounded-[1px]"
          // Transform and opacity only, and declared ahead of time: twenty-eight of these
          // enter at once, halfway through the fold, which is the exact moment worth handing
          // the compositor its layers before it discovers it needs them.
          style={{ backgroundColor: piece.hue, willChange: "transform, opacity" }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{ x: piece.x * 2.4, y: [0, -90, 240], opacity: [1, 1, 0], rotate: piece.rotate * 2 }}
          transition={{ duration: beat.duration, delay: beat.at + piece.delay, ease: "easeOut" }}
        />
      ))}
    </div>
  )
}

/** Two decimals, without pulling a formatter in for one line. */
function formatAmount(value: string) {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(2) : value
}

/**
 * Counts a number up from zero.
 *
 * The point is direction. A claimed share landing as a finished figure next to the packet's
 * larger balance reads ambiguously; watching it climb from nothing does not.
 *
 * It climbs without React seeing any of it. The previous version called `setState` on every
 * frame, so the whole claim page — envelope, folding flap, twenty-eight confetti pieces — was
 * reconciled sixty times a second during the busiest stretch of the sequence, for the sake of
 * one text node. A motion value writes to that node directly, and this component renders once.
 */
function CountUp({ to, decimals = 2, beat }: { to: number; decimals?: number; beat: Beat }) {
  const count = useMotionValue(0)
  const text = useTransform(count, (v) =>
    v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  )

  useEffect(() => {
    if (!Number.isFinite(to)) return
    // From wherever the figure currently stands rather than from zero, so that flipping the
    // currency toggle afterwards slides between the two amounts instead of dropping to nothing
    // and climbing again.
    const controls = animate(count, to, { duration: beat.duration, delay: beat.at, ease: EASE_RISE })
    return () => controls.stop()
  }, [to, count, beat.at, beat.duration])

  return <motion.span>{text}</motion.span>
}

export default function ClaimPacketPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  const router = useRouter()
  const { user, isLoading, isAuthenticated } = useAuth()
  const { details, isLoading: loadingPacket, claiming, error, claimed, load, claim } = useClaimPacket(code)
  const currency = useLocalCurrency(isAuthenticated)

  const [opened, setOpened] = useState(false)
  const [celebrating, setCelebrating] = useState(false)
  const [showLocal, setShowLocal] = useState(false)
  const reduced = useReducedMotion() ?? false

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      // Keep the destination so the claim resumes after sign-in.
      router.replace("/get-started")
    }
  }, [isLoading, isAuthenticated, router])

  useEffect(() => {
    void load()
  }, [load])

  // A packet claimed in an earlier session opens flat — no confetti. The celebration belongs to
  // the moment it happened.
  useEffect(() => {
    if (details?.alreadyClaimed && !claimed) setOpened(true)
  }, [details?.alreadyClaimed, claimed])

  // The one clock. The envelope reads the same beats out of the same module, so the flap, the
  // note, the amount and the burst can no longer drift apart the way they had.
  const hasLetter = Boolean(opened && details?.message)
  const timeline = useMemo(() => openTimeline({ hasLetter, reduced }), [hasLetter, reduced])

  const handleOpen = useCallback(async () => {
    // Gated on the result: this used to open the envelope and fire confetti even when the claim
    // had failed, because `claim()` resolved the same way either way.
    const result = await claim()
    if (!result) return
    setOpened(true)
    // Someone who has asked their phone for less motion has not asked for paper in the air.
    if (reduced) return
    setCelebrating(true)
    setTimeout(() => setCelebrating(false), timeline.celebrationMs)
  }, [claim, reduced, timeline.celebrationMs])

  const theme = PACKET_THEMES.find((t) => t.id === details?.theme) ?? PACKET_THEMES[0]

  if (isLoading || (loadingPacket && !details)) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-black/20" />
      </div>
    )
  }

  if (!user) return null

  if (!details) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center p-6 font-sans">
        <div className="text-center space-y-4 max-w-sm">
          <Gift className="w-10 h-10 mx-auto text-black/15" />
          <p className="text-sm font-semibold text-black/60">{error ?? "Packet not found"}</p>
          {/* A mistyped code is the common case, so the first way out is another attempt. */}
          <button
            onClick={() => router.push("/packet?tab=claim")}
            className="w-full py-4 bg-black text-white rounded-2xl font-bold"
          >
            Try another code
          </button>
          <button
            onClick={() => router.push("/home")}
            className="w-full py-3 rounded-2xl border-2 border-black/10 font-bold text-sm hover:border-black/25 transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  const amountShown = claimed?.amount ?? details.myAmount
  const headlineAmount = opened && amountShown ? amountShown : details.remainingAmount
  const localAmount = formatLocal(Number(headlineAmount), currency)
  const leftForOthers = formatAmount(details.remainingAmount)

  return (
    <div className="min-h-dvh bg-white font-sans">
      <div className="relative max-w-lg mx-auto px-5 py-6 space-y-6">
        <AnimatePresence>{celebrating && <Confetti beat={timeline.confetti} />}</AnimatePresence>

        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/home")}
            aria-label="Back"
            className="p-2 -ml-2 rounded-full hover:bg-black/5 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-black tracking-tight">Packet</h1>
        </div>

        {/* Anticipation while the payout confirms on-chain — deliberately small, because the
            opening itself is the animation the user is waiting for, not this. */}
        <motion.div
          animate={
            claiming
              ? { rotate: [0, -1.2, 1.2, -0.8, 0.8, 0], scale: 1 }
              : { rotate: 0, scale: opened ? 1.02 : 1 }
          }
          transition={
            claiming
              ? { duration: 0.55, repeat: Infinity }
              : // Settles before the contents rise. Overlapping the two had the amount being
                // scaled by an ancestor while it was also moving under its own transform, which
                // is what kept the figure soft for the first half-second of its life.
                { type: "spring", stiffness: 320, damping: 26 }
          }
        >
          <PacketEnvelope
            theme={theme}
            size="lg"
            opened={opened}
            // Only once it's open. Printing the note on a sealed envelope gives away the one
            // thing opening it is for; closed, it just says there is something inside.
            letter={
              opened && details.message ? (
                <PacketLetter text={details.message} from={details.fromName} />
              ) : undefined
            }
          >
            {/* Keyed, so opening mounts a *new* element rather than editing the number in
                place. Before this, the headline went from the packet's remaining balance to
                your smaller share inside one node — which read as your money going down, when
                what actually happened is you gained the difference. */}
            <AnimatePresence mode="wait" initial={false}>
              {opened && amountShown ? (
                <motion.div
                  key="claimed"
                  // This element owns the amount's entrance outright. The envelope's content
                  // wrapper is inert now, so nothing else is moving it — which it was, from the
                  // other file, half a second later. No `scale` either: growing the figure while
                  // its own digits are still changing is what made counting up read as blur.
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: timeline.amountEntrance.duration,
                    delay: timeline.amountEntrance.at,
                    ease: EASE_RISE,
                  }}
                  className="space-y-0.5"
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-70">
                    You got
                  </p>
                  {/* Counting up from zero, with the sign, so the direction is unmistakable. */}
                  <p className="text-5xl font-black tabular-nums drop-shadow">
                    +
                    <CountUp
                      to={Number(showLocal && localAmount ? localAmount.replace(/[^\d.]/g, "") : amountShown)}
                      decimals={showLocal && currency ? currency.decimals : 2}
                      beat={timeline.countUpEntrance}
                    />
                  </p>
                  <p className="text-sm font-bold opacity-80">
                    {showLocal && localAmount ? currency?.code : "USDC"}
                  </p>
                  <p className="text-[11px] opacity-70 pt-2">
                    {Number(details.remainingAmount) > 0
                      ? `${leftForOthers} USDC still in the packet`
                      : "That was the last of it"}
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  key="unopened"
                  exit={{ opacity: 0, scale: 0.92 }}
                  transition={{ duration: timeline.swap.duration }}
                  className="space-y-0.5"
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-70">
                    {details.splitMode === "random" ? "Random split" : "Equal split"}
                  </p>
                  <p className="text-3xl font-black tabular-nums drop-shadow">
                    {showLocal && localAmount ? localAmount : formatAmount(details.remainingAmount)}
                  </p>
                  <p className="text-sm font-bold opacity-80">
                    {showLocal && localAmount ? `${currency?.code} in here` : "USDC in here"}
                  </p>
                  <p className="text-[11px] opacity-70 pt-2">
                    {details.claimedCount} of {details.slots} claimed
                  </p>
                  {details.message && (
                    <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold opacity-75 mt-2 px-2.5 py-1 rounded-full bg-white/15">
                      <Mail className="w-3 h-3" />
                      There&apos;s a note inside
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </PacketEnvelope>
        </motion.div>

        {currency && (
          <button
            onClick={() => setShowLocal((v) => !v)}
            className="mx-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/[0.05] text-[10px] font-bold uppercase tracking-widest text-black/55 hover:bg-black/10 transition-colors"
          >
            <ArrowLeftRight className="w-3 h-3" />
            Show in {showLocal ? "USDC" : currency.code}
          </button>
        )}

        {claimed?.txHash && (
          <a
            href={explorerTxUrl(claimed.txHash)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 text-xs font-semibold text-amber-700 hover:underline"
          >
            View on BscScan <ExternalLink className="w-3 h-3" />
          </a>
        )}

        {error && <p className="text-sm font-medium text-red-600 text-center">{error}</p>}

        {details.alreadyClaimed || claimed ? (
          <div className="space-y-2">
            <button
              onClick={() => router.push("/home")}
              className="w-full py-4 bg-black text-white rounded-2xl font-bold active:scale-[0.98] transition-transform"
            >
              Back to Home
            </button>
            <button
              onClick={() => router.push("/packet?tab=claim")}
              className="w-full py-3 rounded-2xl border-2 border-black/10 font-bold text-sm hover:border-black/25 transition-colors"
            >
              Open another packet
            </button>
          </div>
        ) : !details.invited ? (
          <div className="p-4 rounded-2xl bg-black/[0.03] border border-black/6 flex items-center gap-2.5 justify-center">
            <Lock className="w-4 h-4 text-black/35" />
            <p className="text-xs font-semibold text-black/50">This packet is for specific numbers</p>
          </div>
        ) : details.claimable ? (
          <button
            onClick={handleOpen}
            disabled={claiming}
            className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-lg disabled:opacity-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            {claiming && <Loader2 className="w-4 h-4 animate-spin" />}
            {claiming ? "Opening…" : "Open packet"}
          </button>
        ) : (
          <div className="p-4 rounded-2xl bg-black/[0.03] border border-black/6 text-center">
            <p className="text-xs font-semibold text-black/50">
              {details.status === "emptied"
                ? "This packet is empty"
                : details.status === "expired"
                  ? "This packet has expired"
                  : details.isCreator
                    ? "You created this packet"
                    : "Nothing left to claim"}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

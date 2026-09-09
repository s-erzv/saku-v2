"use client"

/**
 * The four hamster cards under "Transfer crypto with phone number".
 *
 * Two things are happening at once:
 *
 * 1. On scroll-in the deck converges — every card starts stacked on the middle
 *    of the visible track and springs out to its own slot. The offsets are
 *    measured from real layout (`offsetLeft`) instead of guessed with fixed
 *    `left-90` values, which is why this now behaves on a phone: the same code
 *    path drives the 4-across desktop row and the swipeable mobile rail.
 * 2. Each card keeps moving after it lands — the hamster bobs, a widget floats
 *    over it, coins drift, and a highlight sweeps the surface.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { MotionConfig, motion, useInView } from "framer-motion"
import { Check, Fingerprint, KeyRound, Lock, ShieldCheck } from "lucide-react"

/* ------------------------------------------------------------ card graphics */

/** Floating gold coin used across the cards. */
function Coin({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border-[2.5px] border-[#C97F1D] bg-gradient-to-br from-[#FFE08A] via-[#FFC93C] to-[#E9A21B] font-black text-[#B4700F] shadow-sm ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.46 }}
    >
      $
    </span>
  )
}

/** The floating panel each graphic lives in, tilted over the hamster. */
function Widget({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={`relative z-20 rounded-2xl border border-black/10 bg-white/85 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.10)] backdrop-blur-sm ${className}`}
      animate={{ y: [0, -6, 0], rotate: [-1, 1, -1] }}
      transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
    >
      {children}
    </motion.div>
  )
}

/** 1 — a wallet address being crossed out and replaced by a phone number. */
function AddressGraphic() {
  return (
    <Widget>
      <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-black/35">
        Recipient
      </p>

      <div className="relative mb-2 w-fit">
        <p className="font-mono text-[11px] font-semibold text-black/45">
          0x7Ac3…F19bE4
        </p>
        <motion.span
          className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-red-500"
          animate={{ width: ["0%", "100%", "100%", "0%", "0%"] }}
          transition={{ duration: 4.5, times: [0, 0.22, 0.8, 0.92, 1], repeat: Infinity }}
        />
      </div>

      <motion.div
        className="flex items-center gap-2 rounded-xl bg-[#0A0A0A] px-2.5 py-1.5"
        animate={{ opacity: [0, 0, 1, 1], scale: [0.9, 0.9, 1, 1] }}
        transition={{ duration: 4.5, times: [0, 0.28, 0.4, 1], repeat: Infinity }}
      >
        <span className="font-mono text-[11px] font-bold text-white">+62 812-3456-7890</span>
        <motion.span
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500"
          animate={{ scale: [0, 0, 1.3, 1, 1] }}
          transition={{ duration: 4.5, times: [0, 0.42, 0.5, 0.56, 1], repeat: Infinity }}
        >
          <Check className="h-2.5 w-2.5 text-white" strokeWidth={5} />
        </motion.span>
      </motion.div>
    </Widget>
  )
}

/** 2 — a coin arcing from sender to receiver. */
function SendGraphic() {
  return (
    <Widget>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col items-center gap-1">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-[#FFE7B0] text-[11px] font-black text-black/60 shadow-sm">
            You
          </span>
          <span className="text-[8px] font-bold text-black/40">Saku</span>
        </div>

        <div className="relative h-9 flex-1">
          <svg viewBox="0 0 100 40" className="absolute inset-0 h-full w-full" aria-hidden>
            <path
              d="M4,30 Q50,-4 96,30"
              fill="none"
              stroke="#00000022"
              strokeWidth="2"
              strokeDasharray="4 5"
              strokeLinecap="round"
            />
          </svg>
          <motion.div
            className="absolute left-0 top-[18px]"
            animate={{ x: [0, 40, 80], y: [0, -20, 0], opacity: [0, 1, 0], scale: [0.7, 1, 0.7] }}
            transition={{ duration: 2, repeat: Infinity, repeatDelay: 0.7, ease: "easeInOut" }}
          >
            <Coin size={18} />
          </motion.div>
        </div>

        <div className="flex flex-col items-center gap-1">
          <motion.span
            className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-[#C9F0D2] text-[11px] font-black text-emerald-800 shadow-sm"
            animate={{ scale: [1, 1, 1.16, 1, 1] }}
            transition={{ duration: 2.7, times: [0, 0.62, 0.72, 0.85, 1], repeat: Infinity }}
          >
            R
          </motion.span>
          <span className="text-[8px] font-bold text-black/40">Rina</span>
        </div>
      </div>

      <p className="mt-2 text-center text-[10px] font-black text-black/60">
        25.00 USDC · arrives in seconds
      </p>
    </Widget>
  )
}

/** 3 — the three stages a transfer actually goes through. */
const STAGES = ["Signed on your device", "Broadcast to BNB Chain", "Confirmed on-chain"]

function StatusGraphic() {
  return (
    <Widget>
      <div className="space-y-1.5">
        {STAGES.map((stage, i) => (
          <div key={stage} className="flex items-center gap-2">
            <motion.span
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500"
              animate={{ scale: [0, 0, 1.25, 1, 1], opacity: [0.2, 0.2, 1, 1, 1] }}
              transition={{
                duration: 4.5,
                times: [0, 0.12 + i * 0.16, 0.2 + i * 0.16, 0.26 + i * 0.16, 1],
                repeat: Infinity,
              }}
            >
              <Check className="h-2.5 w-2.5 text-white" strokeWidth={5} />
            </motion.span>
            <span className="text-[10px] font-bold text-black/55">{stage}</span>
          </div>
        ))}
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/10">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-500"
          style={{ transformOrigin: "left" }}
          animate={{ scaleX: [0, 1, 1, 0] }}
          transition={{ duration: 4.5, times: [0, 0.62, 0.9, 1], repeat: Infinity }}
        />
      </div>
    </Widget>
  )
}

/** 4 — the key split into shards that never meet in one place. */
const SHARDS = [
  { icon: Fingerprint, label: "Device" },
  { icon: KeyRound, label: "Saku" },
  { icon: ShieldCheck, label: "Backup" },
]

function SecurityGraphic() {
  return (
    <Widget>
      <div className="mb-2 flex items-center gap-1.5">
        <Lock className="h-3 w-3 text-black/50" strokeWidth={3} />
        <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-black/35">
          Key split 3 ways
        </p>
      </div>

      <div className="flex items-end justify-between gap-1.5">
        {SHARDS.map((shard, i) => {
          const Icon = shard.icon
          return (
            <motion.div
              key={shard.label}
              className="flex flex-1 flex-col items-center gap-1 rounded-xl bg-black/5 px-1 py-1.5"
              animate={{
                backgroundColor: ["rgba(0,0,0,0.05)", "rgba(16,185,129,0.18)", "rgba(0,0,0,0.05)"],
                y: [0, -3, 0],
              }}
              transition={{ duration: 3, delay: i * 0.35, repeat: Infinity, ease: "easeInOut" }}
            >
              <Icon className="h-3.5 w-3.5 text-black/60" strokeWidth={2.5} />
              <span className="text-[8px] font-bold text-black/45">{shard.label}</span>
            </motion.div>
          )
        })}
      </div>

      <p className="mt-2 text-[9px] font-semibold leading-snug text-black/45">
        No single party can move your funds.
      </p>
    </Widget>
  )
}

/* ---------------------------------------------------------------- card model */

type Card = {
  title: string
  bg: string
  hamster: string
  hamsterClass: string
  graphic: ReactNode
}

const CARDS: Card[] = [
  {
    title: "No more long wallet addresses.",
    bg: "#F0F8A4",
    hamster: "/landing/card1.png",
    hamsterClass: "-bottom-4 left-1/2 w-[78%] -translate-x-1/2",
    graphic: <AddressGraphic />,
  },
  {
    title: "Send money with just a phone number.",
    bg: "#F7DF78",
    hamster: "/landing/card2.png",
    hamsterClass: "-bottom-6 left-1/2 w-[74%] -translate-x-1/2",
    graphic: <SendGraphic />,
  },
  {
    title: "Transfer tokens without worry.",
    bg: "#F0F8A4",
    hamster: "/landing/card3.png",
    hamsterClass: "-bottom-4 left-1/2 w-[80%] -translate-x-1/2",
    graphic: <StatusGraphic />,
  },
  {
    title: "Secure by design.",
    bg: "#F7DF78",
    hamster: "/landing/card4.png",
    hamsterClass: "-bottom-6 -left-6 w-[72%]",
    graphic: <SecurityGraphic />,
  },
]

// How the deck sits before it spreads: a stack with a little fan to it.
const STACK_ROTATE = [-7, -2.5, 2.5, 7]

/* -------------------------------------------------------------------- slider */

export default function Slider() {
  const trackRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Array<HTMLElement | null>>([])
  const inView = useInView(trackRef, { once: true, amount: 0.25 })

  // Distance each card must travel from the centre of the visible track to its
  // own slot. Measured, so it is correct at every breakpoint and after resize.
  const [offsets, setOffsets] = useState<number[]>(() => CARDS.map(() => 0))
  const [active, setActive] = useState(0)

  const measure = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    const origin = track.scrollLeft + track.clientWidth / 2
    setOffsets(
      cardRefs.current.map((el) =>
        el ? origin - (el.offsetLeft + el.offsetWidth / 2) : 0,
      ),
    )
  }, [])

  useEffect(() => {
    measure()
    const track = trackRef.current
    if (!track) return
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    return () => observer.disconnect()
  }, [measure])

  // Which card the mobile rail is parked on, for the dots.
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const onScroll = () => {
      const step = track.scrollWidth / CARDS.length
      setActive(Math.min(CARDS.length - 1, Math.round(track.scrollLeft / step)))
    }
    track.addEventListener("scroll", onScroll, { passive: true })
    return () => track.removeEventListener("scroll", onScroll)
  }, [])

  const goTo = (i: number) => {
    const el = cardRefs.current[i]
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
  }

  return (
    <MotionConfig reducedMotion="user">
      <div>
        <div
          ref={trackRef}
          className="scrollbar-hide relative flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-6 sm:gap-5 xl:snap-none xl:gap-6 xl:overflow-visible xl:px-0"
        >
          {CARDS.map((card, i) => (
            <motion.article
              key={card.title}
              ref={(el) => {
                cardRefs.current[i] = el
              }}
              className="group relative h-[430px] text-left w-[76vw] max-w-[340px] shrink-0 snap-center overflow-hidden rounded-[2rem] border border-black/10 p-6 shadow-[0_18px_45px_rgba(0,0,0,0.08)] sm:h-[460px] sm:w-[46vw] md:w-[38vw] lg:h-[500px] lg:w-[31vw] lg:p-7 xl:w-auto xl:min-w-0 xl:max-w-none xl:flex-1 xl:shrink"
              style={{ backgroundColor: card.bg }}
              initial={false}
              animate={
                inView
                  ? { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 }
                  : { x: offsets[i], y: 24, rotate: STACK_ROTATE[i], scale: 0.86, opacity: 0 }
              }
              transition={{
                type: "spring",
                stiffness: 55,
                damping: 15,
                mass: 0.9,
                delay: inView ? i * 0.09 : 0,
              }}
              whileHover={{ y: -10, transition: { type: "spring", stiffness: 300, damping: 20 } }}
            >
              {/* Highlight sweeping the surface. */}
              <motion.div
                className="pointer-events-none absolute inset-0 z-30 -skew-x-12 bg-gradient-to-r from-transparent via-white/45 to-transparent"
                aria-hidden
                animate={{ x: ["-160%", "160%"] }}
                transition={{ duration: 3.2, repeat: Infinity, repeatDelay: 4 + i, ease: "easeInOut" }}
              />

              {/* Coins drifting up behind everything. */}
              <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
                {[0, 1, 2].map((c) => (
                  <motion.span
                    key={c}
                    className="absolute"
                    style={{ left: `${18 + c * 28}%`, bottom: "-12%" }}
                    animate={{ y: [0, -260], opacity: [0, 0.85, 0], rotate: [0, 90] }}
                    transition={{
                      duration: 7 + c * 1.4,
                      delay: c * 1.8 + i * 0.5,
                      repeat: Infinity,
                      ease: "easeOut",
                    }}
                  >
                    <Coin size={14 + c * 4} />
                  </motion.span>
                ))}
              </div>

              <p className="relative z-20 text-2xl font-medium leading-snug text-black/85 lg:text-[28px]">
                {card.title}
              </p>

              <div className="relative z-20 mt-5">{card.graphic}</div>

              <motion.img
                src={card.hamster}
                alt=""
                className={`pointer-events-none absolute z-10 ${card.hamsterClass}`}
                animate={{ y: [0, -10, 0], rotate: [-1.5, 1.5, -1.5] }}
                transition={{ duration: 4.5 + i * 0.4, repeat: Infinity, ease: "easeInOut" }}
              />
            </motion.article>
          ))}
        </div>

        {/* Rail position, mobile only — the desktop row shows all four at once. */}
        <div className="mt-1 flex justify-center gap-2 xl:hidden">
          {CARDS.map((card, i) => (
            <button
              key={card.title}
              onClick={() => goTo(i)}
              aria-label={`Go to card ${i + 1}`}
              className={`h-2 rounded-full transition-all duration-300 ${
                active === i ? "w-6 bg-black/70" : "w-2 bg-black/20"
              }`}
            />
          ))}
        </div>
      </div>
    </MotionConfig>
  )
}

"use client"

/**
 * Bouncy feature cards for the Saku landing page.
 *
 * Layout and hover mechanic follow the 21st.dev "bouncy cards" recipe: the card
 * dips and tilts on hover while the panel behind the title rises to meet it.
 * What sits inside each panel is drawn here rather than screenshotted — four
 * looping graphics, one per Saku flow (send, top up, earn, share), so nothing
 * goes stale when the product UI moves.
 */

import { useEffect, type ReactNode } from "react"
import {
  MotionConfig,
  animate,
  motion,
  useMotionValue,
  useTransform,
} from "framer-motion"
import { ArrowUpRight, Check, Sparkles, TrendingUp } from "lucide-react"

/* ---------------------------------------------------------------- primitives */

function BounceCard({
  className = "",
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <motion.div
      whileHover={{ scale: 0.95, rotate: "-1deg" }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
      className={`group relative min-h-[400px] md:min-h-[430px] cursor-pointer overflow-hidden rounded-[2rem] border border-black/5 bg-[#FAF4E7] p-8 ${className}`}
    >
      {children}
    </motion.div>
  )
}

function CardTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mx-auto max-w-[15ch] text-center text-2xl font-semibold leading-tight text-black/85 md:text-3xl">
      {children}
    </h3>
  )
}

/** The panel that peeks up from the bottom of a card and holds the graphic. */
function CardPanel({
  className = "",
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={`absolute bottom-0 left-4 right-4 top-32 translate-y-8 overflow-hidden rounded-t-[1.5rem] px-4 pb-12 pt-4 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] transition-transform duration-[250ms] group-hover:translate-y-4 group-hover:rotate-[2deg] ${className}`}
    >
      {children}
    </div>
  )
}

/** Slow-drifting specks, used behind every panel so nothing is ever fully still. */
function Motes({ count = 6, className = "bg-white/50" }: { count?: number; className?: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <motion.span
          key={i}
          className={`absolute rounded-full ${className}`}
          style={{
            width: 4 + (i % 3) * 3,
            height: 4 + (i % 3) * 3,
            left: `${8 + i * 15}%`,
            bottom: "-10%",
          }}
          animate={{ y: [0, -180], opacity: [0, 0.9, 0], scale: [0.6, 1, 0.6] }}
          transition={{
            duration: 6 + (i % 4),
            delay: i * 0.9,
            repeat: Infinity,
            ease: "easeOut",
          }}
        />
      ))}
    </div>
  )
}

/** A gold coin with the Saku dollar face. */
function Coin({ size = 26, label = "$" }: { size?: number; label?: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full border-[2.5px] border-[#C97F1D] bg-gradient-to-br from-[#FFE08A] via-[#FFC93C] to-[#E9A21B] font-black text-[#B4700F] shadow-sm"
      style={{ width: size, height: size, fontSize: size * 0.46 }}
    >
      {label}
    </span>
  )
}

/* ------------------------------------------------------- graphic 1: send flow */

const PHONE = "+62 812-3456-7890"
const SEND_CYCLE = 4.4

function SendGraphic() {
  const caret = useMotionValue(0)
  const typed = useTransform(caret, (v) => PHONE.slice(0, Math.round(v)))

  useEffect(() => {
    const controls = animate(caret, PHONE.length, {
      duration: 1.9,
      ease: "linear",
      repeat: Infinity,
      repeatDelay: SEND_CYCLE - 1.9,
      repeatType: "loop",
    })
    return () => controls.stop()
  }, [caret])

  return (
    <div className="relative flex h-full flex-col gap-3">
      <Motes count={5} className="bg-white/45" />

      <p className="relative text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">
        Send to
      </p>

      {/* The number being keyed in, with a blinking caret. */}
      <div className="relative flex items-center gap-1 rounded-2xl border border-white/40 bg-white/25 px-3 py-2.5 backdrop-blur-sm">
        <motion.span className="font-mono text-[13px] font-bold tracking-tight text-white sm:text-sm">
          {typed}
        </motion.span>
        <motion.span
          className="inline-block h-4 w-[2px] bg-white"
          animate={{ opacity: [1, 1, 0, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, times: [0, 0.5, 0.51, 1] }}
        />
      </div>

      {/* The account that number resolves to, once typing finishes. */}
      <motion.div
        className="relative flex items-center gap-2.5 rounded-2xl border border-white/40 bg-white/85 px-3 py-2.5 shadow-sm"
        animate={{ opacity: [0, 0, 1, 1, 0], y: [10, 10, 0, 0, 10] }}
        transition={{
          duration: SEND_CYCLE,
          times: [0, 0.44, 0.55, 0.9, 1],
          repeat: Infinity,
        }}
      >
        <img
          src="/landing/card2.png"
          alt=""
          className="h-8 w-8 shrink-0 rounded-full bg-[#FFF1CF] object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-black leading-tight text-black/80">Rina H.</p>
          <p className="text-[9px] font-semibold text-black/40">Saku user</p>
        </div>
        <motion.span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"
          animate={{ scale: [0, 0, 1.25, 1, 1] }}
          transition={{
            duration: SEND_CYCLE,
            times: [0, 0.5, 0.6, 0.66, 1],
            repeat: Infinity,
          }}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={4} />
        </motion.span>
      </motion.div>

      {/* The amount leaving, as a coin that lifts off the card. */}
      <div className="relative mt-auto flex items-end justify-between">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/80">Amount</p>
          <p className="text-xl font-black leading-tight text-white">25.00</p>
          <p className="text-[9px] font-bold text-white/80">USDC</p>
        </div>
        <motion.div
          animate={{ y: [6, -34], opacity: [0, 1, 0], rotate: [0, 28] }}
          transition={{
            duration: 1.6,
            repeat: Infinity,
            repeatDelay: SEND_CYCLE - 1.6,
            delay: 2.6,
            ease: "easeOut",
          }}
        >
          <Coin size={30} />
        </motion.div>
      </div>
    </div>
  )
}

/* ----------------------------------------------------- graphic 2: top-up flow */

function TopUpGraphic() {
  const usdc = useMotionValue(0)
  const usdcText = useTransform(usdc, (v) => v.toFixed(2))

  useEffect(() => {
    const controls = animate(usdc, 15.42, {
      duration: 2.4,
      ease: "easeOut",
      repeat: Infinity,
      repeatDelay: 1.6,
      repeatType: "loop",
    })
    return () => controls.stop()
  }, [usdc])

  return (
    <div className="relative flex h-full flex-col justify-between gap-4">
      <Motes count={7} className="bg-white/45" />

      <div className="relative flex items-center gap-3">
        {/* Rupiah in. */}
        <div className="shrink-0 rounded-2xl border border-white/40 bg-white/85 px-3 py-2 shadow-sm">
          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-black/35">Rupiah</p>
          <p className="whitespace-nowrap text-sm font-black text-black/80">Rp 250.000</p>
        </div>

        {/* Coins crossing the rail. */}
        <div className="relative h-9 flex-1">
          <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/40" />
          <motion.div
            className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white"
            style={{ transformOrigin: "left" }}
            animate={{ scaleX: [0, 1, 1, 0] }}
            transition={{ duration: 4, times: [0, 0.5, 0.85, 1], repeat: Infinity }}
          />
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="absolute top-1/2 -translate-y-1/2"
              animate={{ left: ["0%", "6%", "82%", "88%"], opacity: [0, 1, 1, 0] }}
              transition={{
                duration: 1.9,
                delay: i * 0.45,
                repeat: Infinity,
                repeatDelay: 0.6,
                ease: "easeInOut",
                times: [0, 0.15, 0.8, 1],
              }}
            >
              <Coin size={22} />
            </motion.div>
          ))}
        </div>

        {/* USDC out, counting up. */}
        <div className="shrink-0 rounded-2xl border border-white/40 bg-white/85 px-3 py-2 shadow-sm">
          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-black/35">USDC</p>
          <p className="text-sm font-black tabular-nums text-black/80">
            <motion.span>{usdcText}</motion.span>
          </p>
        </div>
      </div>

      {/* Weekly volume, breathing. */}
      <div className="relative">
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/85">
            This week
          </p>
          <p className="flex items-center gap-1 text-[10px] font-black text-white">
            <ArrowUpRight className="h-3 w-3" strokeWidth={3} />
            +18%
          </p>
        </div>
        <div className="flex h-16 items-end gap-1.5">
          {[38, 62, 44, 78, 56, 92, 70].map((h, i) => (
            <motion.div
              key={i}
              className="flex-1 rounded-t-md bg-white/70"
              style={{ transformOrigin: "bottom" }}
              animate={{ height: [`${h * 0.55}%`, `${h}%`, `${h * 0.72}%`] }}
              transition={{
                duration: 2.6,
                delay: i * 0.12,
                repeat: Infinity,
                repeatType: "mirror",
                ease: "easeInOut",
              }}
            />
          ))}
        </div>
      </div>

      <p className="relative text-[10px] font-semibold leading-snug text-white/85">
        Card, e-wallet or bank in. Spend, send or cash out from the same balance.
      </p>
    </div>
  )
}

/* -------------------------------------------------------- graphic 3: earnings */

const CURVE =
  "M0,118 C40,116 62,104 100,106 C140,108 152,80 190,74 C230,68 242,50 280,44 C318,38 344,22 400,12"
const CURVE_AREA = `${CURVE} L400,140 L0,140 Z`

function EarnGraphic() {
  const apy = useMotionValue(0)
  const apyText = useTransform(apy, (v) => v.toFixed(2))

  useEffect(() => {
    const controls = animate(apy, 8.42, {
      duration: 2.6,
      ease: "easeOut",
      repeat: Infinity,
      repeatDelay: 2.2,
      repeatType: "loop",
    })
    return () => controls.stop()
  }, [apy])

  return (
    <div className="relative flex h-full flex-col">
      <Motes count={5} className="bg-white/40" />

      <div className="relative mb-1 flex items-start justify-between">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/85">
            Current APY
          </p>
          <p className="text-2xl font-black tabular-nums leading-tight text-white">
            <motion.span>{apyText}</motion.span>%
          </p>
        </div>
        <motion.span
          className="flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-black text-emerald-700 shadow-sm"
          animate={{ y: [0, -3, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        >
          <TrendingUp className="h-3 w-3" strokeWidth={3} />
          Live on-chain
        </motion.span>
      </div>

      {/* The reward curve, redrawn on every loop. */}
      <div className="relative mt-auto">
        <svg viewBox="0 0 400 140" className="h-[110px] w-full md:h-[130px]" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="saku-earn-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </defs>

          {[30, 60, 90, 120].map((y) => (
            <line
              key={y}
              x1="0"
              y1={y}
              x2="400"
              y2={y}
              stroke="#ffffff"
              strokeOpacity="0.25"
              strokeWidth="1"
              strokeDasharray="4 6"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <motion.path
            d={CURVE_AREA}
            fill="url(#saku-earn-fill)"
            animate={{ opacity: [0, 1, 1, 0] }}
            transition={{ duration: 4.8, times: [0, 0.35, 0.85, 1], repeat: Infinity }}
          />
          <motion.path
            d={CURVE}
            fill="none"
            stroke="#ffffff"
            strokeWidth="3.5"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: [0, 1, 1, 0] }}
            transition={{ duration: 4.8, times: [0, 0.5, 0.88, 1], repeat: Infinity, ease: "easeInOut" }}
          />
        </svg>

        {/* Payout marker riding the end of the curve. */}
        <motion.div
          className="absolute right-[2%] top-0 flex -translate-y-1/2 items-center gap-1 rounded-full bg-white px-2 py-1 text-[9px] font-black text-emerald-700 shadow-md"
          animate={{ opacity: [0, 0, 1, 1, 0], scale: [0.7, 0.7, 1, 1, 0.7] }}
          transition={{ duration: 4.8, times: [0, 0.5, 0.6, 0.88, 1], repeat: Infinity }}
        >
          <Sparkles className="h-2.5 w-2.5" strokeWidth={3} />
          +12.80
        </motion.div>

        <div className="mt-1 flex justify-between text-[8px] font-bold uppercase tracking-wider text-white/60">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- graphic 4: split */

const SHARES = [
  { x: "-34%", name: "Adi" },
  { x: "0%", name: "Rina" },
  { x: "34%", name: "Bayu" },
]

function SplitGraphic() {
  return (
    <div className="relative flex h-full flex-col items-center justify-between">
      <Motes count={5} className="bg-white/45" />

      <div className="relative w-full rounded-2xl border border-white/40 bg-white/85 px-3 py-2 text-left shadow-sm">
        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-black/35">Dinner bill</p>
        <p className="text-sm font-black text-black/80">Rp 480.000</p>
      </div>

      {/* One bill breaking into three shares. */}
      <div className="relative flex h-20 w-full items-center justify-center">
        <motion.div
          animate={{ scale: [1, 1, 0.4, 0.4], opacity: [1, 1, 0, 0] }}
          transition={{ duration: 3.2, times: [0, 0.35, 0.55, 1], repeat: Infinity }}
        >
          <Coin size={40} />
        </motion.div>

        {SHARES.map((share, i) => (
          <motion.div
            key={share.name}
            className="absolute"
            animate={{
              x: ["0%", "0%", share.x, share.x, share.x],
              y: [0, 0, 34, 34, 34],
              opacity: [0, 0, 1, 1, 0],
              scale: [0.5, 0.5, 1, 1, 1],
            }}
            transition={{
              duration: 3.2,
              times: [0, 0.35, 0.6, 0.85, 1],
              repeat: Infinity,
              delay: i * 0.06,
              ease: "easeOut",
            }}
          >
            <Coin size={22} />
          </motion.div>
        ))}
      </div>

      {/* Each share landing on a person. */}
      <div className="relative flex w-full items-start justify-between">
        {SHARES.map((share, i) => (
          <div key={share.name} className="flex flex-1 flex-col items-center gap-1">
            <motion.span
              className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-white/85 text-[10px] font-black text-black/70 shadow-sm"
              animate={{ scale: [1, 1, 1.18, 1, 1] }}
              transition={{
                duration: 3.2,
                times: [0, 0.62, 0.7, 0.8, 1],
                repeat: Infinity,
                delay: i * 0.06,
              }}
            >
              {share.name[0]}
            </motion.span>
            <span className="text-[8px] font-bold text-white/85">Rp 160k</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- section */

export function BouncyCardsFeatures() {
  return (
    <MotionConfig reducedMotion="user">
      <section className="mx-auto w-full max-w-7xl px-4 py-12 text-black/85">
        <div className="mb-8 flex flex-col items-start justify-between gap-4 text-left md:flex-row md:items-end md:px-8">
          <h2 className="max-w-xl text-4xl font-semibold leading-tight md:text-5xl">
            Easy use, get crypto transfers
            <span className="text-black/35"> done fast.</span>
          </h2>
          <motion.a
            href="/get-started"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="whitespace-nowrap rounded-full border border-black/10 bg-black px-6 py-3 font-medium text-white shadow-xl transition-colors hover:bg-black/80"
          >
            Try Saku now
          </motion.a>
        </div>

        <div className="mb-4 grid grid-cols-12 gap-4">
          <BounceCard className="col-span-12 md:col-span-4">
            <CardTitle>Send to a phone number</CardTitle>
            <CardPanel className="bg-gradient-to-br from-amber-500 to-orange-600">
              <SendGraphic />
            </CardPanel>
          </BounceCard>

          <BounceCard className="col-span-12 md:col-span-8">
            <CardTitle>Top up once, spend anywhere</CardTitle>
            <CardPanel className="bg-gradient-to-br from-amber-400 to-orange-500">
              <TopUpGraphic />
            </CardPanel>
          </BounceCard>
        </div>

        <div className="grid grid-cols-12 gap-4">
          <BounceCard className="col-span-12 md:col-span-8">
            <CardTitle>Earn while it sits still</CardTitle>
            <CardPanel className="bg-gradient-to-br from-emerald-400 to-teal-500">
              <EarnGraphic />
            </CardPanel>
          </BounceCard>

          <BounceCard className="col-span-12 md:col-span-4">
            <CardTitle>Split bills in one tap</CardTitle>
            <CardPanel className="bg-gradient-to-br from-rose-400 to-red-500">
              <SplitGraphic />
            </CardPanel>
          </BounceCard>
        </div>
      </section>
    </MotionConfig>
  )
}

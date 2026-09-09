"use client"

/**
 * A packet envelope, drawn from a theme.
 *
 * Everything is CSS and inline SVG — flap, wax seal, motif, gloss — so adding a theme means
 * adding colours to `lib/packet-themes.ts` and nothing else.
 *
 * Layout note, because this is what was wrong before: the decoration is absolutely positioned
 * and the *content is not*. Children used to be pinned at `top: 58%` of the card, which meant a
 * packet with a long message ran straight through the sparkles and out of the bottom edge. Now
 * the card is a flex column — a fixed flap region, then a `flex-1` well the content centres
 * itself in — so content can grow to whatever it needs and the decoration can never be in its
 * way. Every absolute layer sits behind it and is `pointer-events-none`.
 */

import { motion } from "framer-motion"
import type { PacketPattern, PacketTheme } from "@/lib/packet-themes"

interface PacketEnvelopeProps {
  theme: PacketTheme
  /** `sm` for the picker thumbnail, `lg` for a hero envelope. */
  size?: "sm" | "lg"
  /** Lifts the flap and lets the contents rise out of the envelope. */
  opened?: boolean
  /** The sender's note, on its own paper. Rises out ahead of the amount. */
  letter?: React.ReactNode
  /** Rendered inside the envelope body — an amount, a claim count, a code. */
  children?: React.ReactNode
  className?: string
}

/**
 * Each motif is one tile, repeated. `currentColor` picks up the ink colour set on the layer, so
 * the same tile works on a dark stock and a pale one.
 */
const PATTERNS: Record<PacketPattern, string | null> = {
  plain: null,
  dots: `<circle cx="10" cy="10" r="2.2" fill="currentColor"/>`,
  stripes: `<path d="M-6 26 L26 -6 M-6 46 L46 -6" stroke="currentColor" stroke-width="3" fill="none"/>`,
  grid: `<path d="M0 0 H40 M0 0 V40" stroke="currentColor" stroke-width="1.5" fill="none"/>`,
  stars: `<path d="M20 6 L22.6 16.4 L33 19 L22.6 21.6 L20 32 L17.4 21.6 L7 19 L17.4 16.4 Z" fill="currentColor"/>`,
  confetti: `<rect x="4" y="6" width="7" height="3" rx="1.5" fill="currentColor" transform="rotate(-25 7 7)"/><rect x="24" y="20" width="6" height="3" rx="1.5" fill="currentColor" transform="rotate(35 27 21)"/><circle cx="30" cy="7" r="2" fill="currentColor"/><circle cx="9" cy="28" r="1.8" fill="currentColor"/>`,
  waves: `<path d="M0 20 Q10 10 20 20 T40 20" stroke="currentColor" stroke-width="2.5" fill="none"/>`,
  batik: `<circle cx="20" cy="20" r="11" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="20" cy="20" r="4" fill="currentColor"/><circle cx="0" cy="0" r="5" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="40" cy="40" r="5" stroke="currentColor" stroke-width="1.6" fill="none"/>`,
  floral: `<g fill="currentColor"><circle cx="20" cy="12" r="4"/><circle cx="28" cy="20" r="4"/><circle cx="20" cy="28" r="4"/><circle cx="12" cy="20" r="4"/></g><circle cx="20" cy="20" r="2.4" fill="currentColor" opacity="0.6"/>`,
  chevron: `<path d="M0 26 L10 14 L20 26 M20 26 L30 14 L40 26" stroke="currentColor" stroke-width="2.6" fill="none"/>`,
  scallop: `<path d="M0 26 A10 10 0 0 1 20 26 A10 10 0 0 1 40 26" stroke="currentColor" stroke-width="2.2" fill="none"/>`,
  clouds: `<path d="M6 26 a6 6 0 0 1 6-6 a8 8 0 0 1 15 1 a5 5 0 0 1 1 10 H12 a6 6 0 0 1-6-5 z" fill="currentColor" opacity="0.85"/>`,
  bamboo: `<g stroke="currentColor" stroke-width="2.4" fill="none"><path d="M12 0 V40 M28 0 V40"/><path d="M6 13 H18 M6 29 H18 M22 5 H34 M22 21 H34 M22 37 H34" stroke-width="1.6"/></g>`,
  coins: `<g stroke="currentColor" stroke-width="1.8" fill="none"><circle cx="13" cy="14" r="7"/><circle cx="28" cy="27" r="7"/></g><circle cx="13" cy="14" r="2" fill="currentColor"/><circle cx="28" cy="27" r="2" fill="currentColor"/>`,
  hearts: `<path d="M20 30 L10 20 a6 6 0 0 1 10-7 a6 6 0 0 1 10 7 z" fill="currentColor"/>`,
  diamonds: `<path d="M20 6 L32 20 L20 34 L8 20 Z" stroke="currentColor" stroke-width="2" fill="none"/><path d="M20 14 L26 20 L20 26 L14 20 Z" fill="currentColor"/>`,
  weave: `<g stroke="currentColor" stroke-width="2.2" fill="none"><path d="M0 10 H16 M24 10 H40 M0 30 H16 M24 30 H40"/><path d="M10 0 V16 M10 24 V40 M30 0 V16 M30 24 V40"/></g>`,
  sparks: `<g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 6 V16 M7 11 H17"/><path d="M29 24 V32 M25 28 H33"/></g><circle cx="31" cy="9" r="2" fill="currentColor"/><circle cx="9" cy="30" r="1.8" fill="currentColor"/>`,
}

const PATTERN_TILE: Record<PacketPattern, number> = {
  plain: 40,
  dots: 20,
  stripes: 20,
  grid: 40,
  stars: 40,
  confetti: 40,
  waves: 40,
  batik: 40,
  floral: 40,
  chevron: 40,
  scallop: 40,
  clouds: 40,
  bamboo: 40,
  coins: 40,
  hearts: 40,
  diamonds: 40,
  weave: 40,
  sparks: 40,
}

function patternUrl(pattern: PacketPattern, color: string) {
  const shape = PATTERNS[pattern]
  if (!shape) return null
  const tile = PATTERN_TILE[pattern]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}" viewBox="0 0 ${tile} ${tile}" color="${color}">${shape}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

export default function PacketEnvelope({
  theme,
  size = "sm",
  opened = false,
  letter,
  children,
  className = "",
}: PacketEnvelopeProps) {
  const Icon = theme.icon
  const large = size === "lg"
  const ink = theme.inkOnLight ? theme.colors.accent : "#ffffff"
  const motif = patternUrl(theme.pattern, ink)

  // The flap's depth is a fraction of the card's WIDTH, not a fixed pixel height. A real
  // envelope's V scales with the envelope; pinning it to 132px meant the same flap on a 118px
  // picker thumbnail and a 470px hero, where it read as a shallow wedge floating near the top
  // rather than a fold.
  //
  // Width, specifically, and not height: the `lg` card is sized by its own content, so a
  // percentage of height would be circular — the flap would depend on the content, and the
  // content's clearance would depend on the flap. Percentage padding resolves against width in
  // CSS, so tying both to width makes them move together with nothing to resolve.
  const flapDepth = large ? 0.34 : 0.46
  const sealSize = large ? 56 : 34
  // Clears the flap's point plus the half of the seal hanging below it, plus breathing room.
  const contentTop = `calc(${(flapDepth * 100).toFixed(0)}% + ${sealSize / 2 + (large ? 16 : 10)}px)`

  return (
    <div
      className={`relative w-full flex flex-col overflow-hidden ${large ? "rounded-[2rem]" : "rounded-2xl"} ${className}`}
      style={{
        background: theme.colors.envelopeBg,
        // `lg` has no fixed ratio: the hero envelope sizes to whatever the amount, message and
        // claim count need. Locking it to a ratio is what forced the old absolute layout.
        aspectRatio: large ? undefined : "3 / 4",
        minHeight: large ? 300 : undefined,
        color: ink,
        boxShadow: large
          ? `0 26px 60px ${theme.colors.accent}55`
          : `inset 0 -12px 24px ${theme.colors.accent}33`,
      }}
    >
      {/* Motif. Behind everything, and never in the way of a tap. */}
      {motif && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ backgroundImage: motif, opacity: theme.inkOnLight ? 0.13 : 0.11 }}
        />
      )}

      {/* Paper weave, so a flat gradient does not read as plastic. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: 0.06,
          backgroundImage:
            "repeating-linear-gradient(45deg, #fff 0 2px, transparent 2px 6px), repeating-linear-gradient(-45deg, #fff 0 2px, transparent 2px 6px)",
        }}
      />

      {/* The flap, and the seal holding it shut.
          One wrapper for both: the seal hangs off the wrapper's bottom edge, which *is* the
          flap's point, so it lands on the fold at every card size instead of being positioned
          by a second calculation that could disagree with the first.
          `perspective` lives here because it has to be on the rotating element's parent — without
          it `rotateX` is an orthographic squash, which is why opening read as the flap flattening
          rather than folding. */}
      <div
        className="absolute inset-x-0 top-0 pointer-events-none"
        style={{ aspectRatio: `1 / ${flapDepth}`, perspective: large ? 1100 : 500 }}
      >
        {/* The fold's shadow: the same triangle, nudged down. A `drop-shadow` filter here used to
            break the card's own border-radius clip in Chrome, which is what left a squared-off
            band poking past the rounded top corners. */}
        <motion.div
          className="absolute inset-0 origin-top"
          style={{
            background: "rgba(0,0,0,0.22)",
            clipPath: "polygon(0 0, 100% 0, 50% 100%)",
            transform: "translateY(3px)",
          }}
          animate={{ opacity: opened ? 0 : 1 }}
          transition={{ duration: 0.3 }}
        />

        {/* No `backfaceVisibility: hidden` — that is what made the flap disappear halfway
            through, the instant the rotation passed 90° and its back turned to the viewer. A
            flap has two sides; the fold only reads as a fold if you can see it all the way over.
            Slow enough to actually watch, too: the previous spring was done in about 150ms. */}
        <motion.div
          className="absolute inset-0 origin-top"
          style={{
            background: theme.colors.envelopeFlap,
            clipPath: "polygon(0 0, 100% 0, 50% 100%)",
            transformStyle: "preserve-3d",
          }}
          // Stops just past upright rather than folding the full 180°. The card clips its own
          // overflow, so everything beyond ~90° happens above the hinge where nothing can be
          // seen anyway — rotating further only spent time on an invisible arc and made the
          // flap look like it had blinked out. The last of it fades instead.
          animate={{ rotateX: opened ? -104 : 0, opacity: opened ? 0 : 1 }}
          transition={{
            rotateX: { duration: opened ? 0.8 : 0.45, ease: [0.45, 0, 0.25, 1], delay: opened ? 0.14 : 0 },
            opacity: { duration: opened ? 0.22 : 0.2, delay: opened ? 0.74 : 0 },
          }}
        />

        <div
          className="absolute left-1/2 bottom-0"
          style={{ transform: "translate(-50%, 50%)" }}
        >
          <motion.div
            className="rounded-full flex items-center justify-center"
            style={{
              width: sealSize,
              height: sealSize,
              backgroundColor: theme.colors.seal,
              boxShadow: `0 6px 16px ${theme.colors.accent}80, inset 0 2px 4px rgba(255,255,255,0.3)`,
            }}
            // The seal breaks before the flap moves — a wax seal that survived the envelope
            // opening would be the confusing part.
            animate={{ opacity: opened ? 0 : 1, scale: opened ? 0.4 : 1, rotate: opened ? -25 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <div
              className="bg-white/95 rounded-full flex items-center justify-center"
              style={{ width: sealSize * 0.62, height: sealSize * 0.62 }}
            >
              <Icon size={Math.round(sealSize * 0.32)} style={{ color: theme.colors.seal }} />
            </div>
          </motion.div>
        </div>
      </div>

      {/* Letterhead: the Saku mark, so a packet screenshotted into a chat still says where it's
          from. Sits above the flap's fold line, in the flap's own corner. */}
      <div
        className={`absolute inset-x-0 top-0 z-10 flex items-center gap-1.5 pointer-events-none ${
          large ? "px-6 pt-5" : "px-3 pt-2.5"
        }`}
        style={{ color: theme.inkOnLight ? theme.colors.accent : "#ffffff" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/saku-mark.png"
          alt=""
          className={large ? "w-6 h-6" : "w-4 h-4"}
          style={{ filter: theme.inkOnLight ? "none" : "drop-shadow(0 1px 2px rgba(0,0,0,0.35))" }}
        />
        <span
          className={`font-black tracking-tight leading-none ${large ? "text-base" : "text-[10px]"}`}
        >
          saku
        </span>
      </div>

      {/* The well. `flex-1` means content decides the height, not a percentage. */}
      <div
        className={`relative z-10 flex-1 flex flex-col items-center text-center ${
          large ? "px-6 pb-7" : "px-3 pb-4"
        }`}
        // Closed, the content has to clear the seal and so sits low in the envelope. Opened,
        // the seal is gone and the clearance with it — the padding relaxing is what makes the
        // contents look like they rose out rather than the flap simply vanishing.
        //
        // A CSS transition rather than framer: the closed value is a `calc()` mixing a
        // width-percentage with pixels, which framer would have to interpolate numerically and
        // cannot.
        style={{
          justifyContent: opened ? "center" : "flex-end",
          // Opened, the flap and seal are gone, but the letterhead in the top corner is not —
          // the contents still have to clear it.
          paddingTop: opened ? (large ? 64 : 34) : contentTop,
          transition: "padding-top 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.45s",
        }}
      >
        {/* The note comes out first, then the money — the order you'd pull them out in. */}
        {letter && (
          <motion.div
            className={`w-full ${large ? "mb-4" : "mb-2"}`}
            initial={false}
            animate={opened ? { y: [30, -6, 0], opacity: [0, 1, 1] } : { y: 0, opacity: 1 }}
            transition={{ duration: 0.75, delay: 0.5 }}
          >
            {letter}
          </motion.div>
        )}

        <motion.div
          className="w-full"
          initial={false}
          animate={opened ? { y: [18, -5, 0], opacity: [0, 1, 1] } : { y: 0, opacity: 1 }}
          transition={{ duration: 0.7, delay: letter ? 0.72 : 0.6 }}
        >
          {children}
        </motion.div>
      </div>

      {/* Gloss sweep, on top of everything but inert. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(115deg, rgba(255,255,255,0) 35%, rgba(255,255,255,0.16) 50%, rgba(255,255,255,0) 65%)",
        }}
      />
    </div>
  )
}

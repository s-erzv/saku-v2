"use client"

/**
 * A packet envelope, drawn from a theme.
 *
 * One component, two sizes: the thumbnail in the style picker and the large one on the claim
 * screen. Everything is CSS and inline SVG — flap, wax seal, gloss sweep, sparkles — so adding a
 * theme means adding colours to `lib/packet-themes.ts` and nothing else. No image assets to
 * keep in sync, and every theme gets the same detail for free.
 */

import type { PacketTheme } from "@/lib/packet-themes"

interface PacketEnvelopeProps {
  theme: PacketTheme
  /** `sm` for the picker thumbnail, `lg` for a hero envelope. */
  size?: "sm" | "lg"
  /** Rendered inside the envelope body — an amount, a message, a code. */
  children?: React.ReactNode
  className?: string
}

export default function PacketEnvelope({
  theme,
  size = "sm",
  children,
  className = "",
}: PacketEnvelopeProps) {
  const Icon = theme.icon
  const large = size === "lg"

  return (
    <div
      className={`relative w-full overflow-hidden ${large ? "rounded-[2rem]" : "rounded-2xl"} ${className}`}
      style={{
        background: theme.colors.envelopeBg,
        aspectRatio: large ? "1 / 0.92" : "3 / 4",
        boxShadow: large
          ? `0 24px 60px ${theme.colors.accent}55`
          : `inset 0 -12px 24px ${theme.colors.accent}33`,
      }}
    >
      {/* Paper texture: a faint diagonal weave so a flat gradient does not read as plastic. */}
      <div
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, #fff 0 2px, transparent 2px 6px), repeating-linear-gradient(-45deg, #fff 0 2px, transparent 2px 6px)",
        }}
      />

      {/* The flap, cut to a point like a real envelope. */}
      <div
        className="absolute top-0 left-0 right-0"
        style={{
          height: "42%",
          background: theme.colors.envelopeFlap,
          clipPath: "polygon(0 0, 100% 0, 50% 88%)",
          filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.18))",
        }}
      />

      {/* Wax seal where the flap meets the body. */}
      <div
        className={`absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full flex items-center justify-center ${
          large ? "w-16 h-16" : "w-9 h-9"
        }`}
        style={{
          top: "34%",
          backgroundColor: theme.colors.seal,
          boxShadow: `0 6px 16px ${theme.colors.accent}80, inset 0 2px 4px rgba(255,255,255,0.25)`,
        }}
      >
        <div
          className={`bg-white rounded-full flex items-center justify-center ${
            large ? "w-10 h-10" : "w-5 h-5"
          }`}
        >
          <Icon size={large ? 20 : 11} style={{ color: theme.colors.seal }} />
        </div>
      </div>

      {/* Decorative rule under the seal — the line/dot/line motif from v1. */}
      <div
        className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5"
        style={{ top: large ? "52%" : "50%" }}
      >
        <div className={`${large ? "w-10" : "w-5"} h-0.5 bg-white/30 rounded-full`} />
        <div className={`${large ? "w-2 h-2" : "w-1 h-1"} bg-white/45 rounded-full`} />
        <div className={`${large ? "w-10" : "w-5"} h-0.5 bg-white/30 rounded-full`} />
      </div>

      {/* Sparkles, offset so no two themes look identically placed. */}
      {[
        { top: "52%", left: "9%", size: large ? 13 : 9 },
        { top: "63%", left: "88%", size: large ? 10 : 7 },
        { top: "78%", left: "6%", size: large ? 8 : 6 },
        { top: "86%", left: "92%", size: large ? 9 : 6 },
      ].map((s) => (
        <svg
          key={`${s.top}-${s.left}`}
          viewBox="0 0 12 12"
          className="absolute opacity-55 pointer-events-none"
          style={{ top: s.top, left: s.left, width: s.size, height: s.size }}
        >
          <rect width="12" height="2" y="5" fill="white" rx="1" />
          <rect width="2" height="12" x="5" fill="white" rx="1" />
        </svg>
      ))}

      {children && (
        <div
          className={`absolute inset-x-0 text-center text-white ${large ? "px-6" : "px-3"}`}
          style={{ top: large ? "58%" : "60%" }}
        >
          {children}
        </div>
      )}

      {/* Gloss sweep across the whole card. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(115deg, rgba(255,255,255,0) 35%, rgba(255,255,255,0.18) 50%, rgba(255,255,255,0) 65%)",
        }}
      />
    </div>
  )
}

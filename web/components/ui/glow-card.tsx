"use client"

/**
 * The lit card shell: a rim that lights up nearest the pointer over a slow warm tint.
 *
 * It is three things stacked: React Bits' `BorderGlow` for the rim, an `AuroraBackdrop` drifting
 * inside it, and a content well on top.
 *
 * It is for cards that are *about* something — Home's services card, and the identity card on
 * Profile, which builds the same arrangement by hand because its interior is dark. It is
 * deliberately not the shell for lists of settings: a lit rim behind a row reading "Push
 * notifications" is decoration competing with the only thing on the row worth reading, which is
 * whether it is on. Those use a plain card; see `SettingsGroup`.
 *
 * `backgroundColor` is opaque white and everything else paints on top of it. That is
 * load-bearing rather than incidental: `BorderGlow` masks its own mesh gradient down to the rim
 * by covering the interior with that colour, so a translucent one leaves the mesh showing
 * through the whole card and the panel washes orange whenever a pointer nears an edge.
 *
 * `animated` sweeps the rim once on mount and defaults to off. One card announcing itself is a
 * flourish; a screenful of them arriving together is a light show. Home's services card is the
 * only caller that turns it on, because it is the only card on that screen.
 *
 * No shadow. `shadow-none!` overrides the drop shadow the component ships, which is sized for a
 * dark card and reads as grime on a white one.
 */

import type { ReactNode } from "react"
import BorderGlow from "@/components/ui/border-glow"
import AuroraBackdrop from "@/components/ui/aurora-backdrop"

// Saku's oranges. Shared by every rim in the app so the glows are one family.
const GLOW_COLORS = ["#F0A353", "#FFD362", "#C97F1D"]

interface GlowCardProps {
  children: ReactNode
  /** Padding and layout for the content well. Replaces the default, so restate padding. */
  className?: string
  radius?: number
  /** Sweep the rim once on mount. Off unless this card is alone on its screen. */
  animated?: boolean
}

export default function GlowCard({
  children,
  className = "p-6",
  radius = 28,
  animated = false,
}: GlowCardProps) {
  return (
    <BorderGlow
      borderRadius={radius}
      backgroundColor="#FFFFFF"
      glowColor="32 90 62"
      glowRadius={radius}
      glowIntensity={0.5}
      colors={GLOW_COLORS}
      fillOpacity={0.22}
      animated={animated}
      className="w-full shadow-none!"
    >
      <div className="relative w-full">
        {/* A pixel inside the shell's radius, so no blob corner shows past the rim. */}
        <AuroraBackdrop className="inset-0" style={{ borderRadius: radius - 1 }} />
        <div className={`relative ${className}`}>{children}</div>
      </div>
    </BorderGlow>
  )
}

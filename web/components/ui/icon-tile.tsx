/**
 * A glyph on a tile — the one way Saku draws a feature's mark.
 *
 * It replaces a rainbow of pastel chips (orange for top up, blue for transfer, purple for split
 * bill…) that gave every feature its own colour and the screen no colour of its own. Two tones:
 *
 *  - `ink` is a bare gilt mark for things you act on — services, the tool rail, the Pay button.
 *  - `soft` is a quiet ink mark for things you read — history rows, notifications, settings.
 *
 * The empty box is intentional alignment space, not a visible tile. Permanent rounded-square
 * backgrounds made every icon compete with its card; selected controls add their own background.
 *
 * `box` and `glyph` replace the preset sizes where a screen scales with the viewport (the app's
 * clamp-based tiles). CSS width on the SVG outranks the `size` attribute, so `glyph` wins.
 */

import type { Icon, IconWeight } from "@phosphor-icons/react"

const SIZES = {
  sm: { box: "h-9 w-9 rounded-[11px]", glyph: 18 },
  md: { box: "h-11 w-11 rounded-[13px]", glyph: 22 },
  lg: { box: "h-12 w-12 rounded-[14px]", glyph: 24 },
} as const

const TONES = {
  ink: "text-[#9A6718]",
  soft: "text-ink/65",
} as const

interface IconTileProps {
  icon: Icon
  tone?: keyof typeof TONES
  size?: keyof typeof SIZES
  weight?: IconWeight
  /** Replaces the preset box size and radius. */
  box?: string
  /** Size classes for the glyph itself. */
  glyph?: string
  className?: string
}

export default function IconTile({
  icon: Glyph,
  tone = "ink",
  size = "md",
  weight,
  box,
  glyph,
  className = "",
}: IconTileProps) {
  const preset = SIZES[size]
  return (
    <span
      aria-hidden
      className={`relative inline-flex shrink-0 items-center justify-center ${box ?? preset.box} ${TONES[tone]} ${className}`}
    >
      <Glyph size={preset.glyph} weight={weight ?? "regular"} className={glyph} />
    </span>
  )
}

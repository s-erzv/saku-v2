/**
 * A glyph on a tile — the one way Saku draws a feature's mark.
 *
 * It replaces a rainbow of pastel chips (orange for top up, blue for transfer, purple for split
 * bill…) that gave every feature its own colour and the screen no colour of its own. Two tones:
 *
 *  - `ink` is the balance card in miniature: warm black, a hairline of gold, the glyph in gilt
 *    duotone. For things you act on — services, the tool rail, the Pay button.
 *  - `soft` is for things you read — history rows, notifications, settings: a pale stone ground
 *    with the glyph in ink, so a list of twenty rows is not twenty black squares.
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
  ink:
    "bg-[linear-gradient(150deg,#2B2721_0%,#15130F_52%,#0B0A08_100%)] text-gilt " +
    "shadow-[inset_0_1px_0_rgb(255_255_255/0.07),inset_0_0_0_1px_rgb(221_186_124/0.18)]",
  soft: "bg-[#F1EFEA] text-ink shadow-[inset_0_0_0_1px_rgb(20_18_14/0.05)]",
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
      <Glyph size={preset.glyph} weight={weight ?? (tone === "ink" ? "duotone" : "regular")} className={glyph} />
    </span>
  )
}

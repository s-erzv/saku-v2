"use client"

/**
 * Sand.
 *
 * Two layers, because one never looks like anything. Fractal noise at a single frequency reads
 * as television static — evenly busy, no structure. Sand has both: fine grain you see up close,
 * and slower drifts of light and shade across it. So one layer is high-frequency speckle and the
 * other is a coarse mottle at a fraction of the opacity, and the eye reads the pair as a surface
 * rather than as interference.
 *
 * Rendered as inline SVG data URIs, not fetched. The layer this replaced pulled its texture from
 * a third-party host, which meant the card rendered flat whenever that host was slow.
 *
 * Blended with `screen`, which is the only choice that works on a near-black card. `overlay` and
 * `soft-light` both compute from the backdrop — overlay is `2 × backdrop × source` below mid-grey
 * — so over `#0A0A0A` they multiply the grain by almost zero and render nothing at all. That is
 * not a subtle-settings problem; it is arithmetic, and no opacity value fixes it. `screen` only
 * ever lightens, so each grain of noise lifts its pixel out of the black and is visible.
 */

interface SandTextureProps {
  /** Overall strength. Past ~0.35 it stops being a texture and starts being a filter. */
  opacity?: number
  /** Grain size in px. Smaller is finer sand; below ~90 it turns to dust. */
  grainSize?: number
  className?: string
}

/** `feTurbulence` as a tileable data URI. Higher frequency = finer grain. */
function noiseUrl(baseFrequency: number, octaves: number): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg'>` +
    `<filter id='n'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='${baseFrequency}' numOctaves='${octaves}' stitchTiles='stitch'/>` +
    `</filter>` +
    `<rect width='100%' height='100%' filter='url(#n)'/>` +
    `</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

export default function SandTexture({
  opacity = 0.22,
  grainSize = 130,
  className = "",
}: SandTextureProps) {
  return (
    <div className={`pointer-events-none absolute inset-0 ${className}`} aria-hidden>
      {/* The grain itself. */}
      <div
        className="absolute inset-0 mix-blend-screen"
        style={{
          backgroundImage: noiseUrl(0.9, 4),
          backgroundSize: `${grainSize}px ${grainSize}px`,
          opacity,
        }}
      />
      {/* The drifts across it. A third of the weight and six times the scale — enough to break
          the speckle into patches, not enough to be seen as its own layer. */}
      <div
        className="absolute inset-0 mix-blend-screen"
        style={{
          backgroundImage: noiseUrl(0.035, 3),
          backgroundSize: `${grainSize * 6}px ${grainSize * 6}px`,
          opacity: opacity * 0.18,
        }}
      />
    </div>
  )
}

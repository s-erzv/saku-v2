"use client"

/**
 * Saku, turning up when something worked.
 *
 * Every success screen in the app ended on the same 16px emerald tick in a circle — correct,
 * legible, and indistinguishable from the tick a form shows for a valid email address. Sending
 * someone money is the good moment in a wallet, and it was being marked with the smallest
 * possible acknowledgement.
 *
 * This is the mark it gets instead: the app's own face, popping in with an overshoot, two rings
 * leaving the middle, and a handful of confetti in Saku's oranges. Nothing new was drawn for it —
 * it is `/logo.png`, the same hamster on the identity card and in the middle of every QR.
 *
 * All of it is CSS on transform and opacity, both of which composite off the main thread. This
 * plays at the exact moment a transaction has just settled, which is the worst possible time to
 * be janking the main thread, and it is also a screen people see often enough that a heavy
 * animation would wear out fast.
 *
 * Reduced motion gets the hamster, still. The animation is the celebration; the sentence beneath
 * it is the information, and that reads fine with nothing moving.
 *
 * Decorative throughout — `aria-hidden` on everything, because a screen reader should hear
 * "Transfer sent", not a description of confetti.
 */

/**
 * Twelve pieces, spread unevenly on purpose: a perfect ring of confetti reads as a clock face.
 *
 * The distances are sized to clear the hamster, not to look right on paper. A burst that travels
 * less than the character's own radius spends its whole life hidden behind it.
 */
const CONFETTI = [
  { dx: -98, dy: -75, spin: -140, delay: 60, color: "#F0A353", size: 7 },
  { dx: 89, dy: -86, spin: 120, delay: 0, color: "#FFD362", size: 9 },
  { dx: -132, dy: 15, spin: 200, delay: 120, color: "#FFD362", size: 6 },
  { dx: 126, dy: 6, spin: -180, delay: 90, color: "#F0A353", size: 8 },
  { dx: -63, dy: 107, spin: 160, delay: 150, color: "#C97F1D", size: 6 },
  { dx: 72, dy: 112, spin: -110, delay: 40, color: "#F0A353", size: 7 },
  { dx: -20, dy: -132, spin: 90, delay: 110, color: "#F0A353", size: 8 },
  { dx: 31, dy: -121, spin: -150, delay: 170, color: "#C97F1D", size: 5 },
  { dx: -112, dy: -20, spin: 130, delay: 200, color: "#FFD362", size: 5 },
  { dx: 109, dy: 63, spin: -90, delay: 130, color: "#FFD362", size: 7 },
  { dx: -43, dy: 126, spin: 170, delay: 80, color: "#F0A353", size: 5 },
  { dx: 8, dy: 138, spin: -200, delay: 190, color: "#C97F1D", size: 6 },
]

interface SakuCelebrationProps {
  /** Width of the hamster in px. The rings and confetti scale off the container, not this. */
  size?: number
  className?: string
}

export default function SakuCelebration({ size = 104, className = "" }: SakuCelebrationProps) {
  return (
    <div
      aria-hidden
      className={`relative mx-auto flex items-center justify-center ${className}`}
      style={{ width: size * 1.9, height: size * 1.9 }}
    >
      {/* Two rings on one delay apart, which is what turns a single expanding circle into a
          pulse rather than a one-off blip. */}
      <span
        className="animate-saku-ring absolute rounded-full border-2 border-[#F0A353]/40"
        style={{ width: size, height: size }}
      />
      <span
        className="animate-saku-ring absolute rounded-full border-2 border-[#FFD362]/50"
        style={{ width: size, height: size, animationDelay: "800ms" }}
      />

      <span
        className="absolute rounded-full bg-[#F0A353]/10"
        style={{ width: size * 1.25, height: size * 1.25 }}
      />

      {/* Two nested spans because the pop and the bob are different animations on the same
          element, and CSS would run only the last one declared. */}
      <span className="animate-saku-pop relative block">
        <span className="animate-saku-bob block">
          <img
            src="/logo.png"
            alt=""
            width={size}
            height={size}
            className="block object-contain drop-shadow-[0_8px_18px_rgba(240,163,83,0.35)]"
            style={{ width: size, height: size }}
          />
        </span>
      </span>
      {CONFETTI.map((piece, i) => (
        <span
          key={i}
          className="animate-saku-confetti absolute rounded-[2px]"
          style={
            {
              width: piece.size,
              height: piece.size * 1.6,
              backgroundColor: piece.color,
              animationDelay: `${piece.delay + 180}ms`,
              "--dx": `${piece.dx}px`,
              "--dy": `${piece.dy}px`,
              "--spin": `${piece.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}

    </div>
  )
}

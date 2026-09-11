/**
 * AuroraBackdrop — slow-moving colour, made to be put *behind* glass.
 *
 * Glass only reads as glass when there is something behind it to bend. Saku's home screen is a
 * white page, so every frosted surface on it was refracting flat white and arriving as a grey
 * box — which is exactly how the first pass of the services card came out. This is what those
 * surfaces refract now: three blurred blobs drifting on periods that do not divide into each
 * other, so the loop never visibly lands back on itself.
 *
 * CSS, not WebGL, and transform/opacity only — both composite off the main thread. This runs for
 * as long as the screen is open, on the most-visited screen in the app, so it has to cost nothing
 * per frame on a mid-range phone. A canvas here would be a second animation loop competing with
 * the waves on the balance card above.
 *
 * Reduced motion stops the drift but keeps the colour: the glass still has something to refract,
 * it just holds still.
 *
 * Positioning is the caller's job — pass `inset-0`, `-inset-4`, a radius, whatever the surface
 * in front of it needs. This only ever paints.
 */

interface AuroraBackdropProps {
  /** Positioning and clipping for the layer. It is `absolute`; you say where. */
  className?: string
  /** For a corner radius the caller computes rather than names — see `GlowCard`. */
  style?: React.CSSProperties
}

export default function AuroraBackdrop({ className = "", style }: AuroraBackdropProps) {
  return (
    <div aria-hidden style={style} className={`pointer-events-none absolute overflow-hidden ${className}`}>
      {/* Saku's orange and its yellow, and a sand that is barely a colour at all. Nothing cool
          and nothing pink: this sits under glass on a white page, it is there to give the
          refraction something to bend, and anything stronger stops being light on a wallet and
          starts being decoration. Three tints is also the ceiling — a fourth, or these same
          three at any real strength, average out to tan, and tan behind glass reads as dirt. */}
      <span className="absolute -left-[22%] -top-[32%] h-[78%] w-[72%] rounded-full blur-3xl animate-aurora-a bg-[radial-gradient(circle,rgba(240,163,83,0.22)_0%,rgba(240,163,83,0)_68%)]" />
      <span className="absolute -right-[20%] -top-[12%] h-[72%] w-[68%] rounded-full blur-3xl animate-aurora-b bg-[radial-gradient(circle,rgba(255,211,98,0.20)_0%,rgba(255,211,98,0)_68%)]" />
      <span className="absolute left-[6%] -bottom-[34%] h-[80%] w-[84%] rounded-full blur-3xl animate-aurora-c bg-[radial-gradient(circle,rgba(233,196,150,0.16)_0%,rgba(233,196,150,0)_68%)]" />
    </div>
  )
}

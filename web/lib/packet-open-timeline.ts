/**
 * When each part of a packet opening happens.
 *
 * This used to be nine unrelated numbers spread across `components/packet/packet-envelope.tsx`
 * and the claim page, and they had drifted out of agreement. The amount sprang into view at
 * 0.35s under one of them and was then yanked back to invisible and re-raised at 0.72s by
 * another, in a different file, which is what made the reveal read as mushy rather than
 * choreographed. Two elements animating the same thing cannot be fixed by tuning either one.
 *
 * So every beat now lives here, and every beat after the first is written in terms of the one
 * before it. Changing how long the flap takes to fold moves everything that waits on the flap,
 * instead of leaving the rest behind.
 *
 * Nothing here animates anything. It only says when.
 */

/** One beat: when it starts, counted from the tap, and how long it runs. Seconds. */
export interface Beat {
  at: number
  duration: number
}

const beat = (at: number, duration: number): Beat => ({ at, duration })
const endOf = (b: Beat) => b.at + b.duration

/** The fold. Slow into the lift, decisive out of it. */
export const EASE_FOLD: [number, number, number, number] = [0.45, 0, 0.25, 1]

/** Everything that rises out of the envelope. Fast start, long settle. */
export const EASE_RISE: [number, number, number, number] = [0.22, 1, 0.36, 1]

export interface OpenTimeline {
  /** The wax seal shattering. */
  seal: Beat
  /** The flap folding back. */
  flap: Beat
  /** The flap fading out over the last of its arc, above the card's clip. */
  flapFade: Beat
  /** The fold's cast shadow going with it. */
  fold: Beat
  /** The sealed-state contents leaving. */
  swap: Beat
  /** The sender's note rising. */
  letter: Beat
  /** The amount rising, counted from the tap. */
  amount: Beat
  /** The figure counting up, counted from the tap. */
  countUp: Beat
  /**
   * The same two beats, counted from the moment the amount block mounts instead of from the
   * tap — which is what anything living inside that block has to be given.
   *
   * The sealed figure and the claimed one are swapped by an `AnimatePresence` in `mode="wait"`,
   * so the new element is not mounted at all until the old one has finished leaving. A delay
   * written from the tap is then applied on top of that wait and lands late by exactly the
   * length of the swap. Everything was arriving 180ms after the clock said it would, which is
   * the same class of drift this module exists to stop.
   */
  amountEntrance: Beat
  countUpEntrance: Beat
  /** The burst. */
  confetti: Beat
  /**
   * When the envelope's content well may silently take its opened geometry, in ms.
   *
   * The well sits at the bottom of a closed envelope, clear of the flap and seal, and in the
   * middle of an open one. That change used to be a `padding-top` transition, which is a
   * layout property: the browser reflowed the whole envelope subtree on every frame of it,
   * while the flap was rotating in 3D and the confetti was in the air. It was the single
   * largest source of dropped frames in the sequence.
   *
   * It does not need to be animated at all. The contents rise into place under their own
   * transform, and between the old ones fading out and the new ones lifting off there is a
   * window where the well holds nothing visible. Moved then, the geometry change costs one
   * reflow and nobody can see it happen.
   */
  wellSwapMs: number
  /** How long to keep the confetti layer mounted, in ms. */
  celebrationMs: number
}

/**
 * @param hasLetter A note pushes the amount back — you pull the letter out first, then the
 *        money. With no note the amount comes straight up behind the flap.
 * @param reduced   Honour `prefers-reduced-motion`. The whole sequence collapses to a single
 *        short cross-fade: the packet still opens and still says what you got, it just does
 *        not perform. Callers should skip the confetti entirely in this mode.
 */
export function openTimeline({ hasLetter = false, reduced = false } = {}): OpenTimeline {
  if (reduced) {
    const instant = beat(0, 0.18)
    return {
      seal: instant,
      flap: instant,
      flapFade: instant,
      fold: instant,
      swap: instant,
      letter: instant,
      amount: instant,
      amountEntrance: instant,
      countUp: beat(0, 0.4),
      countUpEntrance: beat(0, 0.4),
      confetti: beat(0, 0),
      wellSwapMs: 0,
      celebrationMs: 0,
    }
  }

  // The seal goes first. An envelope whose flap lifts through an intact wax seal is the one
  // detail people notice without being able to say why.
  const seal = beat(0, 0.22)

  // The flap starts while the seal is still coming apart, so the two read as one gesture
  // rather than a queue.
  const flap = beat(seal.duration * 0.6, 0.78)

  // The card clips its own overflow, so the last of the arc happens above the hinge where
  // there is nothing to see. It fades out there instead of rotating on into nothing.
  const flapFade = beat(flap.at + flap.duration * 0.72, 0.22)
  const fold = beat(flap.at, 0.3)

  // The sealed contents leave immediately — they are what the tap was asking to replace.
  const swap = beat(0, 0.18)

  // Everything below waits for the flap to be far enough back that the well is not opening
  // into the underside of it. Far enough, not all the way: waiting for the fold to finish put
  // the figure a full 1.3s after the tap, which is slower to the payoff than the version this
  // replaces. Smoother must not mean longer.
  const clear = flap.at + flap.duration * 0.42

  const letter = beat(clear, 0.58)
  const amount = beat(hasLetter ? letter.at + 0.18 : clear + 0.06, 0.5)
  const countUp = beat(amount.at + amount.duration * 0.2, 0.85)
  const confetti = beat(clear + 0.1, 1.5)

  // Hoisted out of its own mount, so that what the caller waits is what this module said.
  const fromMount = (b: Beat): Beat => ({ at: Math.max(0, b.at - swap.duration), duration: b.duration })

  return {
    seal,
    flap,
    flapFade,
    fold,
    swap,
    letter,
    amount,
    countUp,
    amountEntrance: fromMount(amount),
    countUpEntrance: fromMount(countUp),
    confetti,
    wellSwapMs: Math.round(endOf(swap) * 1000),
    celebrationMs: Math.round((endOf(confetti) + 0.2) * 1000),
  }
}

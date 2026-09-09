"use client"

/**
 * The note a packet carries, drawn as a slip of paper tucked inside the envelope.
 *
 * The message used to render as one dim line above the amount, which made it read as a caption
 * on the packet — a label the app had written. It is neither: it is the one thing in a packet a
 * person wrote by hand, so it gets its own paper, its own hand, and it comes *out* of the
 * envelope with the money rather than being printed on it.
 *
 * Cream stock on a coloured envelope, deliberately: a note in the envelope's own colours would
 * be part of the envelope. Paper is a different object.
 */

import { PAPER } from "@/lib/receipt-content"

interface PacketLetterProps {
  text: string
  /** Signed, when we know who wrote it. */
  from?: string | null
  /** Tighter type for the create-screen preview, where the card sits at about half size. */
  compact?: boolean
}

export default function PacketLetter({ text, from, compact = false }: PacketLetterProps) {
  return (
    <div
      className={`w-full text-left rounded-xl overflow-hidden ${compact ? "px-3 py-2.5" : "px-4 py-3.5"}`}
      style={{
        // The faint horizontal rules of note paper, under the paper's own gradient.
        backgroundImage: `repeating-linear-gradient(${PAPER.hairline} 0 1px, transparent 1px 22px), linear-gradient(${PAPER.top}, ${PAPER.bottom})`,
        backgroundPosition: "0 12px, 0 0",
        color: PAPER.ink,
        boxShadow: "0 8px 20px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.6)",
        // A slip of paper that went in by hand does not sit perfectly square.
        transform: "rotate(-1.1deg)",
      }}
    >
      <p
        className={`whitespace-pre-line break-words ${compact ? "text-[15px]" : "text-[19px]"} leading-[22px]`}
        style={{ fontFamily: "var(--font-letter), ui-rounded, Georgia, serif", fontWeight: 600 }}
      >
        {text}
      </p>

      {from && (
        <p
          className={`mt-2 text-right ${compact ? "text-[13px]" : "text-[16px]"} leading-none opacity-55`}
          style={{ fontFamily: "var(--font-letter), ui-rounded, Georgia, serif" }}
        >
          — {from}
        </p>
      )}
    </div>
  )
}

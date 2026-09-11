"use client"

/**
 * A card of settings rows under one heading.
 *
 * One card per *group* rather than one card per setting. The screen this replaced had five cards
 * of equal weight in a column, which is the layout that makes a page feel long and flat at the
 * same time: nothing is grouped, so nothing can be skipped, and every card costs a paragraph of
 * vertical space to say one thing.
 *
 * The heading sits outside the card, the same way `SectionHeading` works on Home — a group's name
 * is a label for the card, not a row inside it.
 */

import type { ReactNode } from "react"

interface SettingsGroupProps {
  /** Sits above the card, in the same weight Home uses for its section titles. */
  title?: string
  children: ReactNode
}

export default function SettingsGroup({ title, children }: SettingsGroupProps) {
  return (
    <section>
      {title && (
        <h2 className="px-1 mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-black/40">
          {title}
        </h2>
      )}
      {/* A plain card, deliberately. The glowing, faintly tinted shell is right for the two
          cards that are *about* something — the balance on Home, the identity card above — and
          wrong for a list of settings: a lit rim behind a row that says "Push notifications" is
          decoration competing with the only thing on the row worth reading, which is whether it
          is on. Settings should be quiet. */}
      <div className="rounded-[28px] border border-black/[0.08] bg-white p-2">
        <div className="divide-y divide-black/[0.05]">{children}</div>
      </div>
    </section>
  )
}

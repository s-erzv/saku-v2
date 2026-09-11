"use client"

/**
 * The heading above a section of the home screen.
 *
 * It sits outside the card it introduces, which is the whole reason it exists as a component.
 * Both "Main Services" and "Recent Activity" used to print their titles *inside* their own card,
 * in the same small grey weight as the labels within them — so the title of a section and the
 * label of a row inside it looked like the same rank of thing, and the screen read as a stack of
 * undifferentiated panels with no spine.
 *
 * Moving the title out and giving it real weight is what creates the hierarchy: heading, then
 * the card as one object beneath it. The trailing link belongs here for the same reason — "see
 * all" is an instruction about the section, not an item in it.
 */

import Link from "next/link"
import { ChevronRight } from "lucide-react"

interface SectionHeadingProps {
  title: string
  /** Omitted when there is nowhere further to go; the link is then simply absent, not disabled. */
  href?: string
  linkLabel?: string
}

export default function SectionHeading({ title, href, linkLabel = "See all" }: SectionHeadingProps) {
  return (
    <div className="flex items-baseline justify-between px-1 mb-3">
      <h2 className="text-lg font-bold tracking-tight text-slate-900">{title}</h2>
      {href && (
        <Link
          href={href}
          className="flex items-center gap-0.5 text-[13px] font-semibold text-black/40 hover:text-black/70 transition-colors"
        >
          {linkLabel}
          <ChevronRight className="w-4 h-4" />
        </Link>
      )}
    </div>
  )
}

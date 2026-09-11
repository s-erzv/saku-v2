"use client"

/**
 * One line of settings: an icon, what it is, and what it is currently set to.
 *
 * The profile screen used to be a stack of six-padding cards, one per setting, each with a
 * heading and a paragraph. Everything was the same size, so a preference about notification
 * sounds looked exactly as important as whether the account survives losing a phone number, and
 * finding any single fact meant scrolling past all of it. Rows fix the scanning problem: the
 * state is on the right of every line, so the screen answers "is my recovery on?" without a tap
 * and without a paragraph.
 *
 * The value on the right is the point of the component. A row that says only "Account recovery"
 * with a chevron has moved the question one tap away rather than answered it.
 *
 * It renders as a link, a button or a plain div depending on what it was given, so a row that
 * does nothing when tapped is not focusable and does not pretend to be pressable.
 */

import Link from "next/link"
import { ChevronRight } from "lucide-react"
import type { ElementType, ReactNode } from "react"

interface SettingsRowProps {
  icon: ElementType
  /** Tailwind classes for the icon chip, e.g. `bg-emerald-50 text-emerald-600`. */
  iconClassName?: string
  label: string
  /** A second line under the label. Keep it to one line — this is a row, not a card. */
  description?: string
  /** The state, on the right. A string, a status chip, a masked number. */
  value?: ReactNode
  /** Replaces the chevron: a toggle, a copy button, a spinner. */
  trailing?: ReactNode
  href?: string
  onClick?: () => void
  /** Whether to draw the chevron. On by default for anything tappable. */
  chevron?: boolean
}

export default function SettingsRow({
  icon: Icon,
  iconClassName = "bg-black/[0.04] text-black/50",
  label,
  description,
  value,
  trailing,
  href,
  onClick,
  chevron,
}: SettingsRowProps) {
  const tappable = !!href || !!onClick
  const showChevron = chevron ?? (tappable && !trailing)

  const body = (
    <>
      <span className={`shrink-0 rounded-xl p-2 ${iconClassName}`}>
        <Icon className="w-[18px] h-[18px]" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold tracking-tight text-slate-900 truncate">{label}</span>
        {description && (
          <span className="block text-[11px] leading-snug text-black/45 mt-0.5">{description}</span>
        )}
      </span>

      {value !== undefined && value !== null && (
        <span className="shrink-0 text-[13px] font-semibold text-black/55 max-w-[45%] truncate text-right">
          {value}
        </span>
      )}

      {trailing}
      {showChevron && <ChevronRight className="w-4 h-4 shrink-0 text-black/25" />}
    </>
  )

  const className =
    "flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors" +
    (tappable ? " hover:bg-black/[0.03] active:bg-black/[0.05]" : "")

  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    )
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {body}
      </button>
    )
  }

  return <div className={className}>{body}</div>
}

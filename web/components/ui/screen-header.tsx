"use client"

/**
 * The top of a screen: a way back, and what the screen is.
 *
 * One component because the same screen now appears in three places — the app, a page of the web
 * wallet, and the web wallet's tool panel — and only the header has to care which. In the panel,
 * the panel's own bar already names the tool and closes it, so this shrinks to the step-back
 * control and disappears when there is no step to go back to.
 *
 * `onBack` is for going back a step *inside* a flow (review → amount). Leaving the screen is not
 * passed in: it is `useScreenNav().exit`, which is Home in the app and "close" in the panel.
 */

import type { ReactNode } from "react"
import { ArrowLeft } from "lucide-react"
import { useInPanel, useScreenNav } from "@/components/web/shell"

interface ScreenHeaderProps {
  title: ReactNode
  onBack?: () => void
  /** Anything that belongs on the header's right, e.g. a count of things waiting. */
  trailing?: ReactNode
}

export default function ScreenHeader({ title, onBack, trailing }: ScreenHeaderProps) {
  const inPanel = useInPanel()
  const { exit } = useScreenNav()

  if (inPanel) {
    if (!onBack && !trailing) return null
    return (
      <div className="flex min-h-9 items-center gap-2">
        {onBack && (
          <button
            onClick={onBack}
            className="-ml-1.5 flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-medium text-black/55 transition-colors hover:text-black"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        )}
        {trailing && <div className="ml-auto flex">{trailing}</div>}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onBack ?? exit}
        aria-label="Back"
        className="p-2 -ml-2 rounded-full hover:bg-black/5 transition-colors"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>
      <h1 className="text-xl font-black tracking-tight truncate">{title}</h1>
      {trailing}
    </div>
  )
}

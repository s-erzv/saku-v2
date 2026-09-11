"use client"

/**
 * `/pay` is the Pay sheet, opened on arrival.
 *
 * Paying used to be a screen of its own, which meant tapping the middle button threw away the
 * bottom bar and the screen underneath for the sake of showing a code. It is a sheet now
 * (`components/pay/pay-sheet.tsx`), opened by that button over whichever screen you were already
 * on, so nothing is navigated away from and closing costs a swipe.
 *
 * The path stays because it was a destination: links already sent, anything deep-linking into
 * paying, a bookmark. It renders the bar with the sheet already up rather than keeping a second
 * copy of the same UI alive to drift out of step with the first, and dismissing it lands on Home.
 *
 * `/pay/[code]` and `/pay/qris` are untouched — those are where a scan *arrives*, and they are
 * ordinary screens with a back button, not this.
 */

import BottomNavigation from "@/components/home/bottom-navigation"

export default function PayPage() {
  return (
    <div className="min-h-dvh bg-white font-sans">
      <BottomNavigation initialPayOpen />
    </div>
  )
}

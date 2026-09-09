"use client"

/**
 * Registers `public/sw.js`, which is what makes the app installable and gives web push somewhere
 * to be delivered.
 *
 * Registration alone asks for nothing and shows nothing — no permission prompt, no banner. The
 * only thing the user is ever asked is the explicit toggle in Profile
 * (`components/profile/push-notifications.tsx`).
 */

import { useEffect } from "react"

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return

    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      // Most commonly a CSP that forgot `worker-src`, which fails quietly otherwise — see
      // middleware.ts.
      console.error("[sw] registration failed:", err)
    })
  }, [])

  return null
}

"use client"

/**
 * Wrapper, and the Suspense boundary is the whole reason it exists.
 *
 * The screen reads the email-verification outcome out of the query string, and `useSearchParams`
 * has no answer until the client takes over — so without a boundary the prerender fails outright
 * rather than degrading. Keeping the boundary here leaves the screen itself free to read the URL
 * directly, which is what lets the outcome be derived at render instead of copied into state.
 */

import { Suspense } from "react"

import AccountSecurity from "@/components/profile/account-security"

export default function AccountSecurityPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-[#FFFCF9] font-sans max-w-lg mx-auto px-5 py-6">
          <p className="text-sm text-muted-foreground">Loading your security settings…</p>
        </div>
      }
    >
      <AccountSecurity />
    </Suspense>
  )
}

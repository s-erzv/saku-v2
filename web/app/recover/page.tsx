"use client"

/** Suspense boundary for the query string the email link redirects back with. */

import { Suspense } from "react"

import RecoverFlow from "@/components/recover/recover-flow"

export default function RecoverPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-[#FFFCF9] font-sans max-w-lg mx-auto px-5 py-6">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      }
    >
      <RecoverFlow />
    </Suspense>
  )
}

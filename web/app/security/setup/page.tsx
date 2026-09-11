"use client"

/**
 * The route the recovery setup lives at.
 *
 * Thin on purpose: it exists so the setup has a URL. The guard is the same one Home runs, because
 * this screen is reachable directly — from Profile, from a link, from someone's history — and
 * every step of it calls an endpoint that needs a session. Sending a signed-out visitor to
 * `get-started` is better than four failed fetches and an empty wizard.
 */

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import RecoverySetup from "@/components/security/recovery-setup"
import { useAuth } from "@/hooks/useAuth"

export default function RecoverySetupPage() {
  const router = useRouter()
  const { isLoading, isAuthenticated } = useAuth()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/get-started")
  }, [isLoading, isAuthenticated, router])

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center font-sans">
        <video className="w-50" src="/logo.webm" autoPlay muted loop playsInline />
      </div>
    )
  }

  if (!isAuthenticated) return null

  return <RecoverySetup />
}

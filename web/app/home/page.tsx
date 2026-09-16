"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/useAuth"
import { APP_HOME, useAppMode } from "@/components/web/app-mode"
import WebHome from "@/components/web/web-home"

/** Browser wallet Home. The installed app has its own route at /app/home. */
export default function HomePage() {
  const router = useRouter()
  const { user, isLoading, isAuthenticated } = useAuth()
  const mode = useAppMode()

  useEffect(() => {
    if (isLoading || mode === null) return
    if (mode === "app") router.replace(APP_HOME)
    else if (!isAuthenticated) router.replace("/get-started?view=web")
  }, [isLoading, isAuthenticated, mode, router])

  if (isLoading || mode === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-white font-sans">
        <video className="w-50" src="/logo.webm" autoPlay muted loop playsInline />
      </div>
    )
  }

  if (mode !== "web" || !user || !isAuthenticated) return null

  return <WebHome />
}

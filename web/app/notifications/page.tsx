"use client"

/**
 * Notifications — the missing read side.
 *
 * `transfer/record`, `offramp/lock`, `split-bill`, `packet`, `qr-payment`, and `topup` have all
 * been writing rows into `notifications` since the v2 rewrite; nothing ever read them back until
 * this page and its API routes. Opening this screen marks everything visible as read, mirroring
 * how a notification centre is expected to behave — the badge on the bell is what's unread,
 * not a manual "mark all" chore.
 */

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Loader2 } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useNotifications } from "@/hooks/useNotifications"
import BottomNavigation from "@/components/home/bottom-navigation"
import NotificationList from "@/components/notifications/notification-list"
import { WEB_HOME, useAppMode } from "@/components/web/app-mode"

export default function NotificationsPage() {
  const router = useRouter()
  const { user, isLoading, isAuthenticated } = useAuth()
  const mode = useAppMode()
  const { notifications, unreadCount, isLoading: loadingNotifications, markAsRead } = useNotifications(50)

  useEffect(() => {
    if (isLoading || mode === null) return
    if (mode === "web") router.replace(WEB_HOME)
    else if (!isAuthenticated) router.replace("/get-started?view=app")
  }, [isLoading, isAuthenticated, mode, router])

  // Opening the screen is the "read" signal — same behaviour as v1.
  useEffect(() => {
    if (unreadCount > 0) void markAsRead()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications.length > 0])

  if (isLoading || mode === null) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-black/20" />
      </div>
    )
  }

  if (mode !== "app" || !user) return null

  return (
    <div className="min-h-dvh bg-white font-sans max-w-lg mx-auto">
      <div className="px-5 py-6 space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/app/home")}
            aria-label="Back"
            className="p-2 -ml-2 rounded-full hover:bg-black/5 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-black tracking-tight">Notifications</h1>
        </div>

        <NotificationList notifications={notifications} isLoading={loadingNotifications} />
      </div>

      <BottomNavigation />
    </div>
  )
}

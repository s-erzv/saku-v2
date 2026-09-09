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
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Bell, Gift, Loader2, Receipt, ScanLine, Users } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useNotifications, type SakuNotification } from "@/hooks/useNotifications"
import BottomNavigation from "@/components/home/bottom-navigation"

/**
 * `notifications.type` is a Postgres enum with only four values — transfer_received,
 * transfer_sent, offramp_status, system — shared across every feature that writes here (a
 * packet claim and a plain wallet-to-wallet transfer are both `transfer_sent`/`transfer_received`
 * from the database's point of view). The icon still needs to tell them apart, so this looks at
 * `metadata`'s shape — which every writer already sets uniquely — before falling back to type.
 */
function iconFor(notification: SakuNotification): typeof Bell {
  const meta = notification.metadata ?? {}
  if ("packet_code" in meta) return Gift
  if ("bill_id" in meta) return Users
  if ("code" in meta) return ScanLine
  if (notification.type === "offramp_status") return Receipt
  if (notification.type === "transfer_received") return ArrowDownLeft
  if (notification.type === "transfer_sent") return ArrowUpRight
  return Bell
}

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return "Just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short" })
}

function Row({ notification }: { notification: SakuNotification }) {
  const Icon = iconFor(notification)

  return (
    <div className={`flex items-start gap-3 p-3 rounded-2xl ${notification.is_read ? "" : "bg-orange-50/60"}`}>
      <div className="w-10 h-10 rounded-2xl bg-black/5 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-black/60" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-black/80">{notification.message}</p>
        <p className="text-[11px] text-black/40 mt-0.5">{timeAgo(notification.created_at)}</p>
      </div>
      {!notification.is_read && <div className="w-2 h-2 rounded-full bg-orange-500 mt-2 shrink-0" />}
    </div>
  )
}

export default function NotificationsPage() {
  const router = useRouter()
  const { user, isLoading, isAuthenticated } = useAuth()
  const { notifications, unreadCount, isLoading: loadingNotifications, markAsRead } = useNotifications(50)

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/get-started")
  }, [isLoading, isAuthenticated, router])

  // Opening the screen is the "read" signal — same behaviour as v1.
  useEffect(() => {
    if (unreadCount > 0) void markAsRead()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications.length > 0])

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-black/20" />
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-dvh bg-white font-sans max-w-lg mx-auto">
      <div className="px-5 py-6 space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/home")}
            aria-label="Back"
            className="p-2 -ml-2 rounded-full hover:bg-black/5 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-black tracking-tight">Notifications</h1>
        </div>

        {loadingNotifications && notifications.length === 0 ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-black/20" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <Bell className="w-10 h-10 mx-auto text-black/12" />
            <p className="text-sm font-medium text-black/40">No notifications yet</p>
          </div>
        ) : (
          <div className="space-y-1">
            {notifications.map((n) => (
              <Row key={n.id} notification={n} />
            ))}
          </div>
        )}
      </div>

      <BottomNavigation />
    </div>
  )
}

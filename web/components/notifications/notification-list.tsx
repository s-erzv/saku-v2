"use client"

import { createElement } from "react"
import Link from "next/link"
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Gift,
  Loader2,
  Receipt,
  ScanLine,
  ShieldCheck,
  Users,
} from "lucide-react"
import type { SakuNotification } from "@/hooks/useNotifications"

function iconFor(notification: SakuNotification): typeof Bell {
  const meta = notification.metadata ?? {}
  if ("guardian_invite_id" in meta || "guardian_id" in meta || "recovery_request_id" in meta) {
    return ShieldCheck
  }
  if ("packet_code" in meta) return Gift
  if ("bill_id" in meta) return Users
  if ("code" in meta) return ScanLine
  if (notification.type === "offramp_status") return Receipt
  if (notification.type === "transfer_received") return ArrowDownLeft
  if (notification.type === "transfer_sent") return ArrowUpRight
  return Bell
}

function hrefFor(notification: SakuNotification): string | null {
  const meta = notification.metadata ?? {}

  if ("guardian_invite_id" in meta || "guardian_id" in meta || "recovery_request_id" in meta) {
    return "/profile/security"
  }

  const billId = meta.bill_id
  if (typeof billId === "string" && billId) return `/split-bill/${billId}`
  if ("packet_code" in meta) return "/packet"
  if ("code" in meta) return "/transactions"

  if (
    notification.type === "transfer_received" ||
    notification.type === "transfer_sent" ||
    notification.type === "offramp_status"
  ) {
    return "/transactions"
  }

  return null
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

function NotificationRow({
  notification,
  onSelect,
}: {
  notification: SakuNotification
  onSelect?: () => void
}) {
  const href = hrefFor(notification)
  const icon = createElement(iconFor(notification), { className: "h-[18px] w-[18px] text-[#9A6718]" })
  const className = `flex items-start gap-3 rounded-xl p-3 text-left ${
    notification.is_read ? "" : "bg-[#FAF6EE]"
  }`
  const body = (
    <>
      <span className="flex h-9 w-6 shrink-0 items-center justify-start" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium leading-snug text-ink/85">{notification.message}</span>
        <span className="mt-1 block text-[11px] text-black/40">{timeAgo(notification.created_at)}</span>
      </span>
      {!notification.is_read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gilt" />}
    </>
  )

  if (!href) return <div className={className}>{body}</div>

  return (
    <Link href={href} onClick={onSelect} className={`${className} transition-colors hover:bg-black/[0.04]`}>
      {body}
    </Link>
  )
}

export default function NotificationList({
  notifications,
  isLoading,
  onSelect,
}: {
  notifications: SakuNotification[]
  isLoading: boolean
  onSelect?: () => void
}) {
  if (isLoading && notifications.length === 0) {
    return (
      <div className="flex justify-center py-14">
        <Loader2 className="h-5 w-5 animate-spin text-black/20" />
      </div>
    )
  }

  if (notifications.length === 0) {
    return (
      <div className="space-y-2 py-14 text-center">
        <Bell className="mx-auto h-8 w-8 text-black/15" />
        <p className="text-sm font-medium text-black/40">No notifications yet</p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {notifications.map((notification) => (
        <NotificationRow key={notification.id} notification={notification} onSelect={onSelect} />
      ))}
    </div>
  )
}

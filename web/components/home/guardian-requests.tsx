"use client"

/**
 * Guardian requests waiting on you, on Home.
 *
 * A recovery request is a decision someone else's account is waiting on, and until this existed
 * it lived in one notification and one row deep inside Settings. Notifications get buried under
 * transfers; resending one every few minutes would train guardians to approve just to make it
 * stop, which is the exact failure a majority vote exists to prevent. A card that stays on Home
 * until it is answered is the reminder that does not nag.
 *
 * It only points the way. Approving happens on `/profile/security`, the one screen that carries
 * the warning about speaking to the person first and the "not in your contacts" flag — a decision
 * this consequential should not have a second, shorter path to "yes".
 *
 * Renders nothing when nothing is waiting. Mirrors `BillsToPay` and `WaitingPackets`: things that
 * arrive addressed to you should look like the same kind of thing.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { ArrowRight, ShieldAlert, UserPlus } from "lucide-react"

import { useAuth } from "@/hooks/useAuth"

interface WaitingItem {
  id: string
  requestedBy: string
  /** True when `requestedBy` is this user's own contact label rather than a self-chosen name. */
  inContacts: boolean
}

export default function GuardianRequests() {
  const router = useRouter()
  const { isAuthenticated } = useAuth()

  const [recoveries, setRecoveries] = useState<WaitingItem[]>([])
  const [invitations, setInvitations] = useState<WaitingItem[]>([])

  useEffect(() => {
    if (!isAuthenticated) return

    let cancelled = false
    fetch("/api/guardians")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setRecoveries(data.recoveries ?? [])
        setInvitations(data.invitations ?? [])
      })
      .catch(() => {
        // Home stays usable without this card; the notification and Settings still hold the request.
      })

    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  if (recoveries.length === 0 && invitations.length === 0) return null

  const items = [
    ...recoveries.map((item) => ({ ...item, kind: "recovery" as const })),
    ...invitations.map((item) => ({ ...item, kind: "invitation" as const })),
  ]

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 font-sans space-y-3">
      <div className="px-1">
        <p className="text-[11px] font-bold text-amber-600">
          Needs your answer
        </p>
        <h2 className="text-lg font-black tracking-tight">
          {recoveries.length > 0
            ? `${recoveries.length} ${recoveries.length === 1 ? "person needs" : "people need"} you as a guardian`
            : `${invitations.length} guardian ${invitations.length === 1 ? "invitation" : "invitations"}`}
        </h2>
      </div>

      <div className="space-y-2">
        {items.map((item, index) => (
          <motion.button
            key={`${item.kind}-${item.id}`}
            onClick={() => router.push("/profile/security")}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.06 }}
            className={`group w-full rounded-3xl backdrop-blur-xl border p-3.5 text-left ${
              item.kind === "recovery"
                ? "bg-amber-50/80 border-amber-200 shadow-[0_10px_30px_rgba(217,119,6,0.12)]"
                : "bg-white/60 border-white/70 shadow-[0_10px_30px_rgba(217,119,6,0.06)]"
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-transform group-hover:rotate-6 ${
                  item.kind === "recovery" ? "bg-amber-200/70 text-amber-700" : "bg-amber-100 text-amber-600"
                }`}
              >
                {item.kind === "recovery" ? <ShieldAlert className="w-5 h-5" /> : <UserPlus className="w-5 h-5" />}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-black tracking-tight truncate">
                  {item.kind === "recovery"
                    ? `${item.requestedBy} is recovering their account`
                    : `${item.requestedBy} wants you as a guardian`}
                </p>
                <p className="text-[11px] text-black/45 truncate">
                  {!item.inContacts
                    ? "Not in your contacts — check who this is first"
                    : item.kind === "recovery"
                      ? "Only confirm if you have spoken to them"
                      : "Accept only if you know them well"}
                </p>
              </div>

              <span className="shrink-0 flex items-center gap-1 px-3.5 py-2 rounded-xl bg-black text-white text-[11px] font-bold group-hover:bg-amber-600 transition-colors">
                Review
                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  )
}

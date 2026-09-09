"use client"

/**
 * Quick-pick chips for bank accounts this device has sent to before. There's no "contacts"
 * equivalent for banks — just `lib/recent-recipients.ts`'s local send-history cache.
 */

import { Landmark } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { getRecentBanks } from "@/lib/recent-recipients"

export default function RecentBanksPicker({
  onPick,
}: {
  onPick: (bankCode: string, accountNumber: string) => void
}) {
  const { user } = useAuth()
  const recents = getRecentBanks(user?.phone_hash)
  if (recents.length === 0) return null

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      {recents.map((r) => (
        <button
          key={`${r.bankCode}-${r.accountNumber}`}
          onClick={() => onPick(r.bankCode, r.accountNumber)}
          className="flex items-center gap-1.5 shrink-0 pl-1.5 pr-3 py-1.5 rounded-full border border-dashed border-black/12 hover:border-black/25 transition-colors"
        >
          <div className="w-6 h-6 rounded-full bg-black/5 flex items-center justify-center">
            <Landmark className="w-3 h-3 text-black/30" />
          </div>
          <span className="text-xs font-bold text-black/55 max-w-[140px] truncate">
            {r.bankName} •••{r.accountNumber.slice(-4)}
          </span>
        </button>
      ))}
    </div>
  )
}

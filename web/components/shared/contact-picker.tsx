"use client"

/**
 * Quick-pick chips for a recipient number field: saved contacts first, then numbers this device
 * has actually sent to before that aren't already a saved contact.
 *
 * Contacts only show a number on the device that saved them (`hooks/useContacts.ts` — the
 * server holds a label and a hash, never the number). Recents are the same trade-off by
 * necessity: `lib/recent-recipients.ts` is a local send-history cache, never sent to the server.
 */

import { User } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useContacts } from "@/hooks/useContacts"
import { getRecentPhones } from "@/lib/recent-recipients"
import { splitContactPhone } from "@/lib/split-contact-phone"

export default function ContactPicker({
  onPick,
}: {
  onPick: (countryCode: string, phone: string) => void
}) {
  const { user } = useAuth()
  const { contacts } = useContacts()
  const known = contacts.filter((c) => !!c.phone)
  const knownNumbers = new Set(known.map((c) => c.phone))

  const recents = getRecentPhones(user?.phone_hash)
    .map((r) => ({ full: `${r.countryCode.replace("+", "")}${r.phone}`, ...r }))
    .filter((r) => !knownNumbers.has(r.full))

  if (known.length === 0 && recents.length === 0) return null

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      {known.map((c) => (
        <button
          key={c.id}
          onClick={() => {
            const { countryCode, phone } = splitContactPhone(c.phone!)
            onPick(countryCode, phone)
          }}
          className="flex items-center gap-1.5 shrink-0 pl-1.5 pr-3 py-1.5 rounded-full border border-black/8 bg-[#FAFAFA] hover:border-black/20 transition-colors"
        >
          <div className="w-6 h-6 rounded-full bg-black/5 flex items-center justify-center">
            <User className="w-3 h-3 text-black/40" />
          </div>
          <span className="text-xs font-bold text-black/70 max-w-[96px] truncate">{c.label}</span>
        </button>
      ))}
      {recents.map((r) => (
        <button
          key={r.full}
          onClick={() => onPick(r.countryCode, r.phone)}
          className="flex items-center gap-1.5 shrink-0 pl-1.5 pr-3 py-1.5 rounded-full border border-dashed border-black/12 hover:border-black/25 transition-colors"
        >
          <div className="w-6 h-6 rounded-full bg-black/5 flex items-center justify-center">
            <User className="w-3 h-3 text-black/30" />
          </div>
          <span className="text-xs font-bold text-black/55">{r.countryCode}{r.phone}</span>
        </button>
      ))}
    </div>
  )
}

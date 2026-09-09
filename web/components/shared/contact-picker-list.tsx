"use client"

/**
 * Pick people from the address book.
 *
 * Selection is by **phone hash**, not phone number. The address book only holds a label and a
 * hash server-side (`hooks/useContacts.ts`); the number itself sits in the cache of whichever
 * device saved the contact. Selecting by number would mean a contact could only be used from the
 * one device that saved it — so the hash, which every device has, is what travels.
 *
 * Shared by the packet's private circle and by split bill's participant list. Both need the same
 * thing: turn "who do I know" into a set of hashes the server can resolve.
 */

import { useMemo, useState } from "react"
import { Check, Search, User, X } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import { useContacts } from "@/hooks/useContacts"

export interface PickedContact {
  label: string
  phoneHash: string
  /** Only present on the device that saved this contact — see `hooks/useContacts.ts`. */
  phone?: string
}

interface ContactPickerListProps {
  /** Selected phone hashes. */
  selected: string[]
  onChange: (hashes: string[], contacts: PickedContact[]) => void
  /** Rendered under the list when anything is selected — the caller's own summary line. */
  footer?: (count: number) => React.ReactNode
  emptyHint?: string
  disabled?: boolean
}

export default function ContactPickerList({
  selected,
  onChange,
  footer,
  emptyHint = "Add them from Profile → Contacts first.",
  disabled,
}: ContactPickerListProps) {
  const { contacts, isLoading } = useContacts()
  const [search, setSearch] = useState("")

  const selectedSet = useMemo(() => new Set(selected), [selected])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return contacts
    return contacts.filter(
      (c) => c.label.toLowerCase().includes(query) || (c.phone ?? "").includes(query)
    )
  }, [contacts, search])

  const selectedContacts = contacts.filter((c) => selectedSet.has(c.phoneHash))

  function toggle(phoneHash: string) {
    const next = selectedSet.has(phoneHash)
      ? selected.filter((h) => h !== phoneHash)
      : [...selected, phoneHash]

    // The hashes are what the server needs; the contacts are what the caller needs to render a
    // name without looking them up again.
    const byHash = new Map(contacts.map((c) => [c.phoneHash, c]))
    onChange(
      next,
      next
        .map((hash) => byHash.get(hash))
        .filter((c): c is NonNullable<typeof c> => Boolean(c))
        .map((c) => ({ label: c.label, phoneHash: c.phoneHash, phone: c.phone }))
    )
  }

  if (isLoading && contacts.length === 0) {
    return <p className="text-xs text-black/40 text-center py-4">Loading your contacts…</p>
  }

  if (contacts.length === 0) {
    return (
      <div className="py-6 text-center rounded-2xl border-2 border-dashed border-black/10 space-y-1">
        <User className="w-6 h-6 mx-auto text-black/15" />
        <p className="text-xs font-medium text-black/40">No saved contacts yet</p>
        <p className="text-[11px] text-black/30">{emptyHint}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-black/30" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search contacts"
          disabled={disabled}
          className="w-full pl-10 pr-4 py-3 bg-[#FAFAFA] border-2 border-transparent rounded-2xl text-sm font-semibold focus:border-black outline-none transition-all"
        />
      </div>

      {selectedContacts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <AnimatePresence initial={false}>
            {selectedContacts.map((c) => (
              <motion.button
                key={c.phoneHash}
                type="button"
                onClick={() => toggle(c.phoneHash)}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                className="flex items-center gap-1 pl-3 pr-1.5 py-1.5 rounded-full bg-black text-white text-[11px] font-bold"
              >
                {c.label}
                <span className="p-0.5 bg-white/20 rounded-full">
                  <X className="w-2.5 h-2.5" />
                </span>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}

      <div className="max-h-56 overflow-y-auto overscroll-contain space-y-1.5 pr-1">
        {filtered.map((contact) => {
          const on = selectedSet.has(contact.phoneHash)
          return (
            <button
              key={contact.id}
              type="button"
              onClick={() => toggle(contact.phoneHash)}
              disabled={disabled}
              className={`w-full flex items-center gap-3 p-3 rounded-2xl border-2 text-left transition-all ${
                on ? "border-black bg-black/[0.02]" : "border-black/[0.07] hover:border-black/20"
              }`}
            >
              <div className="w-9 h-9 rounded-xl bg-black/[0.05] flex items-center justify-center shrink-0 text-sm font-black text-black/40">
                {contact.label.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold truncate">{contact.label}</p>
                <p className="text-[11px] text-black/40 truncate">
                  {contact.phone ?? (contact.onSaku ? "On Saku" : "Not on Saku yet")}
                </p>
              </div>
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  on ? "bg-black border-black text-white" : "border-black/15"
                }`}
              >
                {on && <Check className="w-3 h-3" strokeWidth={3.5} />}
              </div>
            </button>
          )
        })}
        {filtered.length === 0 && (
          <p className="text-xs text-black/35 text-center py-4">No contact matches “{search}”.</p>
        )}
      </div>

      {selected.length > 0 && footer?.(selected.length)}
    </div>
  )
}

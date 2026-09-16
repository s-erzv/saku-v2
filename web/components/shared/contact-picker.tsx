"use client"

/** Saved Saku contacts everywhere, plus the device address book where the browser exposes it. */

import { useState, useSyncExternalStore } from "react"
import { ChevronDown, ContactRound, Search, Smartphone, User } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { type Contact, useContacts } from "@/hooks/useContacts"
import { getRecentPhones } from "@/lib/recent-recipients"
import { splitContactPhone, splitDeviceContactPhone } from "@/lib/split-contact-phone"
import ProfileAvatar from "@/components/ui/profile-avatar"

interface DeviceContact {
  tel?: string[]
}

interface ContactManager {
  select: (
    properties: Array<"tel">,
    options: { multiple: boolean }
  ) => Promise<DeviceContact[]>
}

interface ContactPickerProps {
  onPick: (countryCode: string, phone: string) => void | Promise<void>
  /** Allows transfer to resolve a saved contact by owner-scoped ID even on a different device. */
  onPickContact?: (contact: Contact) => void | Promise<void>
  defaultCountryCode?: string
  disabled?: boolean
}

const noSubscription = () => () => {}

function deviceContactsAvailable() {
  const manager = (navigator as Navigator & { contacts?: ContactManager }).contacts
  return typeof manager?.select === "function"
}

export default function ContactPicker({
  onPick,
  onPickContact,
  defaultCountryCode = "+62",
  disabled,
}: ContactPickerProps) {
  const { user } = useAuth()
  const { contacts, isLoading } = useContacts()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const canPickDeviceContacts = useSyncExternalStore(
    noSubscription,
    deviceContactsAvailable,
    () => false
  )

  const known = contacts.filter((c) => !!c.phone)
  const knownNumbers = new Set(known.map((c) => c.phone))
  const recents = getRecentPhones(user?.phone_hash)
    .map((r) => ({ full: `${r.countryCode.replace("+", "")}${r.phone}`, ...r }))
    .filter((r) => !knownNumbers.has(r.full))

  const availableContacts = onPickContact ? contacts : known
  const query = search.trim().toLowerCase()
  const filteredContacts = availableContacts.filter(
    (contact) =>
      !query ||
      contact.label.toLowerCase().includes(query) ||
      contact.sakuName?.toLowerCase().includes(query) ||
      contact.phone?.includes(query)
  )
  const filteredRecents = recents.filter(
    (recent) => !query || `${recent.countryCode}${recent.phone}`.includes(query)
  )

  const close = () => {
    setOpen(false)
    setSearch("")
  }

  const pickSavedContact = (contact: Contact) => {
    close()
    if (onPickContact) {
      void onPickContact(contact)
      return
    }

    if (!contact.phone) return
    const { countryCode, phone } = splitContactPhone(contact.phone)
    void onPick(countryCode, phone)
  }

  const pickDeviceContact = async () => {
    const manager = (navigator as Navigator & { contacts?: ContactManager }).contacts
    if (!manager) return

    try {
      const [contact] = await manager.select(["tel"], { multiple: false })
      const phoneNumber = contact?.tel?.[0]
      if (!phoneNumber) return

      close()
      const { countryCode, phone } = splitDeviceContactPhone(phoneNumber, defaultCountryCode)
      await onPick(countryCode, phone)
    } catch {
      // Cancelling or denying the native picker leaves the transfer form unchanged.
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border-2 border-black/10 text-left hover:border-black/25 disabled:opacity-40 transition-colors"
      >
        <div className="w-9 h-9 rounded-xl bg-black/[0.05] flex items-center justify-center shrink-0">
          <ContactRound className="w-4 h-4 text-black/55" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Choose from contacts</p>
          <p className="text-[11px] text-black/40">
            {isLoading ? "Loading contacts…" : `${availableContacts.length} saved`}
          </p>
        </div>
        <ChevronDown className={`w-4 h-4 text-black/35 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="rounded-2xl border border-black/10 bg-white p-3 space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
          {canPickDeviceContacts && (
            <button
              type="button"
              onClick={() => void pickDeviceContact()}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-black text-white text-left active:scale-[0.99] transition-transform"
            >
              <Smartphone className="w-4 h-4" />
              <span className="text-sm font-bold">Choose from phone contacts</span>
            </button>
          )}

          {(availableContacts.length > 0 || recents.length > 0) && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/30" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search contacts"
                autoFocus
                className="w-full pl-9 pr-3 py-2.5 bg-[#FAFAFA] rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-black"
              />
            </div>
          )}

          <div className="max-h-64 overflow-y-auto overscroll-contain space-y-1">
            {filteredContacts.map((contact) => (
              <button
                key={contact.id}
                type="button"
                onClick={() => pickSavedContact(contact)}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl text-left hover:bg-black/[0.04] transition-colors"
              >
                <ProfileAvatar
                  src={contact.avatarUrl}
                  name={contact.label}
                  className="w-9 h-9"
                  textClassName="text-[11px]"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate">{contact.label}</p>
                  <p className="text-[11px] text-black/40 truncate">
                    {contact.phone
                      ? `+${contact.phone}`
                      : contact.sakuName || (contact.onSaku ? "On Saku" : "Not on Saku yet")}
                  </p>
                </div>
                {contact.onSaku && (
                  <span className="shrink-0 rounded-full bg-black/[0.05] px-2 py-1 text-[10px] font-bold text-black/45">
                    Saku
                  </span>
                )}
              </button>
            ))}

            {filteredRecents.map((recent) => (
              <button
                key={recent.full}
                type="button"
                onClick={() => {
                  close()
                  void onPick(recent.countryCode, recent.phone)
                }}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl text-left hover:bg-black/[0.04] transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-black/[0.05] flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-black/35" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate">{recent.countryCode}{recent.phone}</p>
                  <p className="text-[11px] text-black/40">Recent recipient</p>
                </div>
              </button>
            ))}

            {filteredContacts.length === 0 && filteredRecents.length === 0 && (
              <div className="py-5 text-center space-y-1">
                <User className="w-5 h-5 mx-auto text-black/20" />
                <p className="text-xs font-medium text-black/40">
                  {query ? "No matching contact" : "No saved contacts yet"}
                </p>
                {!query && !canPickDeviceContacts && (
                  <p className="text-[11px] text-black/30">Add one from Profile → Contacts.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

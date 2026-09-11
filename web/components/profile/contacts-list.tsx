"use client"

/**
 * The Contacts tab on the profile screen.
 *
 * A contact is a label plus a phone hash on the server, so a number only shows when *this*
 * device is the one that saved it. That asymmetry is a deliberate consequence of not storing
 * phone numbers, and the row simply omits what it does not know rather than explaining the
 * storage model in the middle of an address book.
 */

import { useState } from "react"
import { Loader2, Plus, Send, Trash2, UserPlus, Users } from "lucide-react"
import { useRouter } from "next/navigation"
import { useContacts } from "@/hooks/useContacts"
import CountryCodeDropdown from "@/components/get-started/country-code-dropdown"
import { useRecipientCountryCode } from "@/hooks/useRecipientCountryCode"
import ProfileAvatar from "@/components/ui/profile-avatar"

export default function ContactsList() {
  const router = useRouter()
  const { contacts, isLoading, error, addContact, removeContact } = useContacts()

  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState("")
  const [phone, setPhone] = useState("")
  const [countryCode, setCountryCode] = useRecipientCountryCode()

  const submit = async () => {
    setBusy(true)
    const saved = await addContact(label.trim(), phone, countryCode.replace("+", ""))
    setBusy(false)
    if (saved) {
      setLabel("")
      setPhone("")
      setAdding(false)
    }
  }

  return (
    <div className="space-y-4">
      {!adding ? (
        <button
          onClick={() => setAdding(true)}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border-2 border-dashed border-black/12 text-sm font-bold text-black/55 hover:border-black/25 hover:text-black transition-colors"
        >
          <UserPlus className="w-4 h-4" /> Add contact
        </button>
      ) : (
        <div className="rounded-3xl border border-black/8 bg-white p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-black/45">Name</label>
            <input
              value={label}
              autoFocus
              maxLength={64}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Budi"
              className="w-full px-4 py-3 bg-[#FAFAFA] border-2 border-transparent rounded-2xl text-sm font-semibold focus:border-black outline-none transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-black/45">Number</label>
            <div className="relative">
              <CountryCodeDropdown onSelect={setCountryCode} selectedCode={countryCode} />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                placeholder="812 3456 7890"
                className="w-full pl-28 pr-4 py-3 bg-[#FAFAFA] border-2 border-transparent rounded-2xl text-sm font-bold focus:border-black outline-none transition-all"
              />
            </div>
          </div>

          {error && <p className="text-xs font-medium text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={() => { setAdding(false); setLabel(""); setPhone("") }}
              className="flex-1 py-3 rounded-2xl border border-black/10 text-sm font-bold"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy || !label.trim() || phone.length < 8}
              className="flex-1 py-3 rounded-2xl bg-black text-white text-sm font-bold disabled:opacity-30 flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Save
            </button>
          </div>
        </div>
      )}

      {isLoading && contacts.length === 0 ? (
        <div className="py-10 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-black/20" />
        </div>
      ) : contacts.length === 0 ? (
        <div className="py-10 text-center space-y-2">
          <Users className="w-8 h-8 mx-auto text-black/15" />
          <p className="text-xs font-medium text-black/40">No contacts yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {contacts.map((c) => {
            const meta = [c.phone ? `+${c.phone}` : null, c.onSaku ? "On Saku" : null]
              .filter(Boolean)
              .join(" · ")

            return (
            <div
              key={c.id}
              className="flex items-center gap-3 p-3.5 rounded-2xl border border-black/[0.08] bg-white"
            >
              {/* Their own picture when they are on Saku and set one, initials otherwise. */}
              <ProfileAvatar src={c.avatarUrl} name={c.label} />

              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold truncate">{c.label}</p>
                {/* Whatever is actually known, and nothing where nothing is.
                    
                    This used to print "Number saved on another device" for any contact whose
                    number this browser did not happen to hold — which is true (the server keeps
                    only the hash, so the plain number lives on whichever device added the
                    contact) and is an explanation of Saku's storage model appearing in the
                    middle of an address book. Next to a row that does show a number it reads as
                    a fault. A row that knows the person is on Saku says so; a row that knows
                    nothing else says nothing else. */}
                {meta && <p className="text-[11px] text-black/40 truncate">{meta}</p>}
                {/* Only when it differs from the label, so a contact filed under their real name
                    does not print it twice. */}
                {c.sakuName && c.sakuName.trim() !== c.label.trim() && (
                  <p className="text-[11px] text-black/30 truncate">Saku name: {c.sakuName}</p>
                )}
              </div>

              {c.onSaku && (
                <button
                  onClick={() => router.push("/transfer")}
                  aria-label={`Send to ${c.label}`}
                  className="p-2.5 rounded-xl bg-black/[0.04] hover:bg-black hover:text-white transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => removeContact(c.id)}
                aria-label={`Remove ${c.label}`}
                className="p-2.5 rounded-xl text-black/30 hover:bg-red-50 hover:text-red-600 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

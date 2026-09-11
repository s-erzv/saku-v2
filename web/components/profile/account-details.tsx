"use client"

/**
 * The Account group: the three facts that identify this account, one row each.
 *
 * These were a panel of boxed form fields, which is the shape you use when someone is filling a
 * form in. Nobody fills this in — two of the three cannot be edited at all, and the third is
 * edited about once. So they are rows that state their value, and the one editable row turns
 * into a field when you tap it.
 *
 * Editing is per-row rather than a mode for the whole panel. The old Edit / Save / Cancel header
 * put the screen into a state where two static fields were also "being edited", which is a
 * promise the panel could not keep.
 *
 * Phone number: Saku stores the number as an HMAC and nothing else, so nothing the *server* can
 * say will ever be the whole number. That is right for a breach and absurd from this side of the
 * screen, where someone is asking what their own number is. So the row prefers this device's own
 * copy, written at verification, which is the same arrangement contacts and recent recipients
 * already use — plain value on the device, hash on the server. Where that copy does not exist,
 * because this is a different device, it falls back to the dialling code and last four digits
 * kept beside the hash: the shape a bank prints, enough for someone with two SIMs to tell which
 * one this is. It stays unedited in all three cases — changing it is a recovery, not a setting.
 */

import { useEffect, useState } from "react"
import { Check, Copy, Loader2, Pencil, Smartphone, User, Wallet, X } from "lucide-react"
import { toast } from "sonner"
import { useAuth } from "@/hooks/useAuth"
import { formatOwnNumber, readOwnNumber } from "@/lib/own-number"
import SettingsGroup from "@/components/profile/settings-group"
import SettingsRow from "@/components/profile/settings-row"

export default function AccountDetails() {
  const { isAuthenticated, user, wallet, refreshUser } = useAuth()
  const [isEditing, setIsEditing] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [fullName, setFullName] = useState(user?.display_name || "")
  const [copied, setCopied] = useState(false)

  const displayName = user?.display_name || "Saku User"
  const walletAddress = wallet?.address || null

  // Masked to a fixed width whatever the number's real length, so the dots are not themselves a
  // digit count. This is the fallback: the server holds only an HMAC of the number, so four
  // digits and a dialling code is the most it can ever say.
  const phoneHint =
    user?.phone_last4 && user?.phone_dial_code
      ? `+${user.phone_dial_code} ••• ••• ${user.phone_last4}`
      : null

  // Read after mount, never during render: `localStorage` does not exist on the server, and a
  // value that differs between the server's HTML and the client's would be a hydration mismatch.
  const [ownNumber, setOwnNumber] = useState<string | null>(null)
  useEffect(() => {
    const stored = readOwnNumber(user?.phone_hash)
    setOwnNumber(stored ? formatOwnNumber(stored) : null)
  }, [user?.phone_hash])

  const saveName = async () => {
    if (!isAuthenticated) return
    const displayName = fullName.trim()
    if (!displayName) return toast.error("Name cannot be empty")

    setIsUpdating(true)
    try {
      const res = await fetch("/api/profile/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || "Failed")

      await refreshUser()
      setIsEditing(false)
      toast.success("Name updated")
    } catch {
      toast.error("Could not update your name")
    } finally {
      setIsUpdating(false)
    }
  }

  const copyAddress = () => {
    if (!walletAddress) return
    navigator.clipboard.writeText(walletAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <SettingsGroup title="Account">
      {isEditing ? (
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="shrink-0 rounded-xl bg-amber-50 p-2 text-amber-600">
            <User className="w-[18px] h-[18px]" />
          </span>
          <input
            value={fullName}
            autoFocus
            maxLength={64}
            onChange={(e) => setFullName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveName()
              if (e.key === "Escape") setIsEditing(false)
            }}
            placeholder="Your name"
            aria-label="Your name"
            className="min-w-0 flex-1 rounded-xl border border-amber-500/60 bg-amber-500/5 px-3 py-2 text-sm font-semibold outline-none"
          />
          <button
            onClick={() => setIsEditing(false)}
            aria-label="Cancel"
            className="shrink-0 rounded-xl p-2 text-black/40 hover:bg-black/[0.04]"
          >
            <X className="w-4 h-4" />
          </button>
          <button
            onClick={saveName}
            disabled={isUpdating}
            aria-label="Save name"
            className="shrink-0 rounded-xl bg-amber-500 p-2 text-black disabled:opacity-50"
          >
            {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
        </div>
      ) : (
        <SettingsRow
          icon={User}
          iconClassName="bg-amber-50 text-amber-600"
          label="Name"
          value={displayName}
          onClick={() => {
            setFullName(user?.display_name || "")
            setIsEditing(true)
          }}
          trailing={<Pencil className="w-3.5 h-3.5 shrink-0 text-black/25" />}
        />
      )}

      {/* Three answers, best first. The device that signed this account in wrote the number
          down at verification and can simply show it — it is the owner's own number and there is
          no reason to make them squint at dots for it. Any other device has only what the server
          can say, which is four digits. An account that has not signed in since either of those
          existed gets the line this row showed everyone before. */}
      <SettingsRow
        icon={Smartphone}
        iconClassName="bg-emerald-50 text-emerald-600"
        label="Phone"
        description={
          ownNumber
            ? "Verified via WhatsApp"
            : phoneHint
              ? "Shown in full on the device you signed in from"
              : undefined
        }
        value={ownNumber ?? phoneHint ?? "Verified via WhatsApp"}
      />

      <SettingsRow
        icon={Wallet}
        iconClassName="bg-blue-50 text-blue-600"
        label="Saku ID"
        value={
          walletAddress ? (
            <span className="font-mono text-[12px]">
              {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
            </span>
          ) : (
            "Not generated yet"
          )
        }
        onClick={walletAddress ? copyAddress : undefined}
        trailing={
          copied ? (
            <Check className="w-4 h-4 shrink-0 text-emerald-600" />
          ) : (
            <Copy className="w-4 h-4 shrink-0 text-black/25" />
          )
        }
      />
    </SettingsGroup>
  )
}

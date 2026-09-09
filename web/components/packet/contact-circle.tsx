"use client"

/**
 * The packet's private circle: `ContactPickerList` plus the one line that is packet-specific.
 *
 * Inviting more people than there are slots is allowed on purpose — that is the whole game. Ten
 * friends, three slots, first three to open it win.
 */

import ContactPickerList from "@/components/shared/contact-picker-list"

export default function ContactCircle({
  selected,
  onChange,
  slots,
  disabled,
}: {
  selected: string[]
  onChange: (hashes: string[]) => void
  slots: number
  disabled?: boolean
}) {
  return (
    <ContactPickerList
      selected={selected}
      onChange={(hashes) => onChange(hashes)}
      disabled={disabled}
      footer={(count) => (
        <p className="text-[11px] text-center text-black/40">
          {count} invited for {slots} {slots === 1 ? "slot" : "slots"}
          {count > slots && " — first to open it wins."}
        </p>
      )}
    />
  )
}

"use client"

/**
 * The line items on a bill, and who had each one.
 *
 * This is the part a scanned receipt was always missing: `/api/ocr` has returned items, prices,
 * quantities and tax since v1, and every one of them was collapsed into a single total on the
 * way to the screen. Editing them here — and tapping a name to say who shared a line — is what
 * makes "you had the satay, I didn't" expressible.
 *
 * Assignment is by participant *id*, not by index: a person removed from the bill halfway
 * through would otherwise silently reassign every line below them to someone else.
 */

import { Plus, Trash2, Users2 } from "lucide-react"
import { formatMoney, itemTotal, type BillItem } from "@/lib/split-bill-math"

interface ItemEditorProps {
  items: BillItem[]
  onChange: (items: BillItem[]) => void
  participants: { id: string; label: string }[]
  currency: { symbol: string; decimals: number; locale: string } | null
}

export default function ItemEditor({ items, onChange, participants, currency }: ItemEditorProps) {
  function update(id: string, patch: Partial<BillItem>) {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function toggleAssignment(item: BillItem, participantId: string) {
    const has = item.assignedTo.includes(participantId)
    update(item.id, {
      assignedTo: has
        ? item.assignedTo.filter((id) => id !== participantId)
        : [...item.assignedTo, participantId],
    })
  }

  function addItem() {
    onChange([
      ...items,
      { id: crypto.randomUUID(), name: "", price: 0, qty: 1, assignedTo: [] },
    ])
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <label className="text-[10px] font-bold uppercase tracking-widest text-black/45">
          Items
        </label>
        <p className="text-[10px] text-black/35">
          {items.length} {items.length === 1 ? "line" : "lines"} · tap a name to assign
        </p>
      </div>

      {items.length === 0 ? (
        <div className="py-6 text-center rounded-2xl border-2 border-dashed border-black/10 space-y-1">
          <Users2 className="w-6 h-6 mx-auto text-black/15" />
          <p className="text-xs font-medium text-black/40">Scan a receipt, or add lines yourself</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const unassigned = item.assignedTo.length === 0

            return (
              <div
                key={item.id}
                className={`rounded-2xl border-2 p-3 space-y-2.5 transition-colors ${
                  unassigned ? "border-amber-200 bg-amber-50/40" : "border-black/[0.07] bg-[#FAFAFA]"
                }`}
              >
                <div className="flex gap-2">
                  <input
                    value={item.name}
                    maxLength={80}
                    onChange={(e) => update(item.id, { name: e.target.value })}
                    placeholder="Item"
                    className="min-w-0 flex-1 px-3 py-2 bg-white border border-black/[0.07] rounded-xl text-sm font-semibold focus:border-black outline-none"
                  />
                  <input
                    inputMode="numeric"
                    value={item.qty || ""}
                    onChange={(e) =>
                      update(item.id, { qty: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) })
                    }
                    aria-label="Quantity"
                    className="w-12 shrink-0 px-2 py-2 bg-white border border-black/[0.07] rounded-xl text-sm font-bold text-center tabular-nums focus:border-black outline-none"
                  />
                  <input
                    inputMode="decimal"
                    value={item.price || ""}
                    onChange={(e) =>
                      update(item.id, { price: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })
                    }
                    placeholder="0"
                    aria-label="Unit price"
                    className="w-24 shrink-0 px-2 py-2 bg-white border border-black/[0.07] rounded-xl text-sm font-bold text-right tabular-nums focus:border-black outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => onChange(items.filter((i) => i.id !== item.id))}
                    aria-label="Remove item"
                    className="p-2 shrink-0 rounded-xl text-black/25 hover:bg-red-50 hover:text-red-600 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {participants.map((person) => {
                    const on = item.assignedTo.includes(person.id)
                    return (
                      <button
                        key={person.id}
                        type="button"
                        onClick={() => toggleAssignment(item, person.id)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all ${
                          on
                            ? "bg-black text-white border-black"
                            : "bg-white text-black/45 border-black/10 hover:border-black/30"
                        }`}
                      >
                        {person.label}
                      </button>
                    )
                  })}
                  <span className="ml-auto text-xs font-black tabular-nums text-black/70">
                    {formatMoney(itemTotal(item), currency)}
                  </span>
                </div>

                {unassigned && (
                  <p className="text-[10px] font-semibold text-amber-700">
                    Nobody assigned — this line gets split across everyone.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      <button
        type="button"
        onClick={addItem}
        className="w-full py-3 rounded-2xl border-2 border-dashed border-black/12 text-xs font-bold text-black/55 hover:border-black/25 transition-colors"
      >
        <Plus className="w-4 h-4 inline mr-1" /> Add item
      </button>
    </div>
  )
}

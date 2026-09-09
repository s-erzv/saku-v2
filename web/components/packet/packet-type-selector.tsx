"use client"

/**
 * The packet style picker.
 *
 * A three-column grid in a fixed-height scroller, not the horizontal rail this used to be. At
 * six styles a rail was fine; past twenty it hides most of the catalogue behind a swipe with no
 * indication of how much is left, and every card is a different distance from the thumb. A grid
 * shows roughly two rows at rest, scrolls predictably, and cannot overflow its container.
 *
 * The card itself stays white rather than taking the theme's own gradient — tinting the card the
 * same colour as the envelope inside it made both wash out. A neutral card gives every theme the
 * same contrast to stand against, which is the entire job of a swatch.
 */

import { motion } from "framer-motion"
import { Check } from "lucide-react"
import { PACKET_THEMES, type PacketTheme } from "@/lib/packet-themes"
import PacketEnvelope from "./packet-envelope"

interface PacketTypeSelectorProps {
  selectedTheme: PacketTheme | null
  onSelectTheme: (theme: PacketTheme) => void
  className?: string
}

export default function PacketTypeSelector({
  selectedTheme,
  onSelectTheme,
  className = "",
}: PacketTypeSelectorProps) {
  return (
    <div className={`w-full ${className}`}>
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h2 className="text-sm font-black tracking-tight">Packet style</h2>
          <p className="text-[11px] text-black/40">{PACKET_THEMES.length} to choose from</p>
        </div>
        {selectedTheme && <p className="text-[11px] font-bold text-black/55">{selectedTheme.name}</p>}
      </div>

      <div className="max-h-[25rem] overflow-y-auto overscroll-contain rounded-2xl [scrollbar-width:thin]">
        <div className="grid grid-cols-3 gap-2.5 p-0.5">
          {PACKET_THEMES.map((theme, index) => {
            const isSelected = selectedTheme?.id === theme.id

            return (
              <motion.button
                key={theme.id}
                type="button"
                onClick={() => onSelectTheme(theme)}
                aria-label={theme.name}
                aria-pressed={isSelected}
                className={`relative rounded-2xl p-2 pb-2.5 bg-white border-2 text-left transition-all duration-200 ${
                  isSelected
                    ? "border-black shadow-lg -translate-y-0.5"
                    : "border-black/[0.08] hover:border-black/25"
                }`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                // Capped so the last row of a long catalogue doesn't fade in a second late.
                transition={{ delay: Math.min(index, 12) * 0.025, duration: 0.22 }}
              >
                {isSelected && (
                  <motion.div
                    className="absolute -top-2 -right-2 w-6 h-6 bg-black rounded-full flex items-center justify-center shadow-md z-20"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 22 }}
                  >
                    <Check size={13} className="text-white" strokeWidth={3.5} />
                  </motion.div>
                )}

                <PacketEnvelope theme={theme} size="sm" />

                <p className="mt-2 text-[11px] font-bold text-black/80 leading-tight truncate">
                  {theme.name}
                </p>
                <p className="text-[9px] text-black/40 leading-tight truncate">{theme.description}</p>
              </motion.button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

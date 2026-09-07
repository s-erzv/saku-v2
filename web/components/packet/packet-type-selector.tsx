"use client"

/**
 * The packet style picker.
 *
 * A horizontal snap-scrolling row, each card showing the same `PacketEnvelope` the claim screen
 * renders at full size — so what the sender picks is literally what the recipient opens.
 *
 * The card itself is white rather than the theme's own gradient. Tinting the card the same
 * colour as the envelope inside it made both wash out, and put white label text on pale
 * backgrounds where it could not be read. A neutral card gives every theme the same contrast to
 * stand against, which is the entire job of a swatch.
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
        {selectedTheme && (
          <p className="text-[11px] font-bold text-black/55">{selectedTheme.name}</p>
        )}
      </div>

      {/* Bleeds to the screen edges so the row reads as scrollable rather than clipped. */}
      <div className="flex overflow-x-auto gap-3 pb-2 -mx-5 px-5 snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {PACKET_THEMES.map((theme, index) => {
          const isSelected = selectedTheme?.id === theme.id

          return (
            <motion.button
              key={theme.id}
              onClick={() => onSelectTheme(theme)}
              aria-label={theme.name}
              aria-pressed={isSelected}
              className={`relative flex-shrink-0 w-[104px] snap-center rounded-2xl p-2 pb-2.5 bg-white border-2 transition-all duration-200 ${
                isSelected
                  ? "border-black shadow-lg -translate-y-0.5"
                  : "border-black/8 hover:border-black/25"
              }`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.03 * index, duration: 0.25 }}
            >
              {isSelected && (
                <motion.div
                  className="absolute -top-2 -right-2 w-6 h-6 bg-black rounded-full flex items-center justify-center shadow-md z-10"
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
              <p className="text-[9px] text-black/40 leading-tight truncate">
                {theme.description}
              </p>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

"use client"

/**
 * Packets addressed to this user, on Home.
 *
 * A private-circle packet is sent to phone numbers, not to a link — so without a surface like
 * this one it is invisible to the people it was made for, and expires unclaimed. This is that
 * surface: it renders nothing at all when there is nothing waiting, so it costs a quiet Home
 * screen nothing.
 *
 * Public packets are deliberately not listed. Those travel by link or code, and a feed of every
 * open packet on the network would turn a gift into something to farm.
 */

import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { ArrowRight, Gift } from "lucide-react"
import { useInvitedPackets } from "@/hooks/usePacket"
import { PACKET_THEMES } from "@/lib/packet-themes"
import { formatPacketAmount } from "@/lib/packet"

export default function WaitingPackets() {
  const router = useRouter()
  const { packets } = useInvitedPackets()

  if (packets.length === 0) return null

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 font-sans space-y-3">
      <div className="flex items-end justify-between px-1">
        <div>
          <p className="text-[11px] font-bold text-[#F0A353]">
            Waiting for you
          </p>
          <h2 className="text-lg font-black tracking-tight">
            {packets.length} {packets.length === 1 ? "packet" : "packets"} to open
          </h2>
        </div>
        <p className="text-[11px] font-bold text-black/25 pb-1">
          Fastest finger
        </p>
      </div>

      <div className="space-y-2">
        {packets.slice(0, 3).map((packet, index) => {
          const colors = (PACKET_THEMES.find((t) => t.id === packet.theme) ?? PACKET_THEMES[0]).colors
          const progress = Math.min(100, (packet.claimedCount / packet.slots) * 100)

          return (
            <motion.button
              key={packet.code}
              onClick={() => router.push(`/packet/claim/${packet.code}`)}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.06 }}
              className="group w-full rounded-3xl bg-white/60 backdrop-blur-xl border border-white/70 p-3.5 shadow-[0_10px_30px_rgba(240,163,83,0.10)] text-left overflow-hidden"
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 text-white shadow-sm transition-transform group-hover:rotate-6"
                  style={{ background: colors.envelopeBg }}
                >
                  <Gift className="w-5 h-5 drop-shadow" />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black tracking-tight truncate flex items-center gap-1.5">
                    From {packet.fromName ?? "a Saku user"}
                    <span className="relative flex w-1.5 h-1.5 shrink-0">
                      <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                      <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    </span>
                  </p>
                  <p className="text-[11px] text-black/40 truncate">
                    {formatPacketAmount(packet.remainingAmount)} USDC left · {packet.claimedCount}/{packet.slots} claimed
                  </p>
                </div>

                <span className="shrink-0 flex items-center gap-1 px-3.5 py-2 rounded-xl bg-black text-white text-[11px] font-bold group-hover:bg-[#F0A353] transition-colors">
                  Open
                  <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                </span>
              </div>

              <div className="mt-3 h-1 rounded-full bg-black/[0.06] overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.6, delay: 0.1 }}
                  className="h-full rounded-full"
                  style={{ backgroundColor: colors.primary }}
                />
              </div>
            </motion.button>
          )
        })}

        {packets.length > 3 && (
          <button
            onClick={() => router.push("/packet?tab=claim")}
            className="w-full py-2.5 text-[11px] font-bold text-black/45 hover:text-black transition-colors"
          >
            See all {packets.length}
          </button>
        )}
      </div>
    </div>
  )
}

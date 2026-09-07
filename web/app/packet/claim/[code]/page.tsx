"use client"

/**
 * Open and claim a packet.
 *
 * The envelope stays closed until the claim resolves, which is the point of the interaction —
 * the amount is decided server-side at claim time (random mode draws from what is left), so
 * revealing it before the payout lands would be showing a number that is not yet true.
 */

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ExternalLink, Gift, Loader2, Lock } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useClaimPacket } from "@/hooks/usePacket"
import { PACKET_THEMES } from "@/lib/packet-themes"
import PacketEnvelope from "@/components/packet/packet-envelope"
import { explorerTxUrl } from "@/lib/config"

export default function ClaimPacketPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  const router = useRouter()
  const { user, isLoading, isAuthenticated } = useAuth()
  const { details, isLoading: loadingPacket, claiming, error, claimed, load, claim } = useClaimPacket(code)
  const [opened, setOpened] = useState(false)

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      // Keep the destination so the claim resumes after sign-in.
      router.replace("/get-started")
    }
  }, [isLoading, isAuthenticated, router])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (claimed) setOpened(true)
  }, [claimed])

  const theme = PACKET_THEMES.find((t) => t.id === details?.theme) ?? PACKET_THEMES[0]

  if (isLoading || (loadingPacket && !details)) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-black/20" />
      </div>
    )
  }

  if (!user) return null

  if (!details) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center p-6 font-sans">
        <div className="text-center space-y-4 max-w-sm">
          <Gift className="w-10 h-10 mx-auto text-black/15" />
          <p className="text-sm font-semibold text-black/60">{error ?? "Packet not found"}</p>
          <button
            onClick={() => router.push("/home")}
            className="w-full py-4 bg-black text-white rounded-2xl font-bold"
          >
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  const amountShown = claimed?.amount ?? details.myAmount

  return (
    <div className="min-h-dvh bg-white font-sans">
      <div className="max-w-lg mx-auto px-5 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/home")}
            aria-label="Back"
            className="p-2 -ml-2 rounded-full hover:bg-black/5 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-black tracking-tight">Packet</h1>
        </div>

        <PacketEnvelope theme={theme} size="lg">
          {details.message && (
            <p className="text-sm font-semibold opacity-95 mb-2">&ldquo;{details.message}&rdquo;</p>
          )}

          {opened && amountShown ? (
            <div className="space-y-0.5 animate-in zoom-in-95 duration-500">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-70">You got</p>
              <p className="text-4xl font-black tabular-nums drop-shadow">{amountShown}</p>
              <p className="text-sm font-bold opacity-80">USDC</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-70">
                {details.splitMode === "random" ? "Random split" : "Equal split"}
              </p>
              <p className="text-3xl font-black tabular-nums drop-shadow">{details.remainingAmount}</p>
              <p className="text-sm font-bold opacity-80">USDC left</p>
            </div>
          )}

          <p className="text-[11px] opacity-70 mt-2">
            {details.claimedCount} of {details.slots} claimed
          </p>
        </PacketEnvelope>

        {claimed?.txHash && (
          <a
            href={explorerTxUrl(claimed.txHash)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 text-xs font-semibold text-amber-700 hover:underline"
          >
            View on BscScan <ExternalLink className="w-3 h-3" />
          </a>
        )}

        {error && <p className="text-sm font-medium text-red-600 text-center">{error}</p>}

        {details.alreadyClaimed || claimed ? (
          <button
            onClick={() => router.push("/home")}
            className="w-full py-4 bg-black text-white rounded-2xl font-bold active:scale-[0.98] transition-transform"
          >
            Back to Home
          </button>
        ) : !details.invited ? (
          <div className="p-4 rounded-2xl bg-black/[0.03] border border-black/6 flex items-center gap-2.5 justify-center">
            <Lock className="w-4 h-4 text-black/35" />
            <p className="text-xs font-semibold text-black/50">This packet is for specific numbers</p>
          </div>
        ) : details.claimable ? (
          <button
            onClick={claim}
            disabled={claiming}
            className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-lg disabled:opacity-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            {claiming && <Loader2 className="w-4 h-4 animate-spin" />}
            {claiming ? "Opening…" : "Open packet"}
          </button>
        ) : (
          <div className="p-4 rounded-2xl bg-black/[0.03] border border-black/6 text-center">
            <p className="text-xs font-semibold text-black/50">
              {details.status === "emptied"
                ? "This packet is empty"
                : details.status === "expired"
                  ? "This packet has expired"
                  : details.isCreator
                    ? "You created this packet"
                    : "Nothing left to claim"}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

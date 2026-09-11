"use client"

/**
 * The balance card.
 *
 * Four bands down a near-black face: who the wallet belongs to, the figure, and the two details
 * worth reading off it. The balance is read straight from BSC Testnet for the MPC wallet, and the
 * holder name comes from the session.
 *
 * One thing moves, and it is the card itself: React Bits' GradientWaves, recoloured to Saku's
 * oranges and turned right down, under a sand grain that gives the light something to fall on. Everything laid on top is still, and the
 * border only lights where the pointer is. That restraint is the whole arrangement — a single
 * moving thing is special only while nothing around it competes, and this card once had three
 * animations at once, none of which read as motion.
 */

import { useState } from "react"
import { CheckCircle, Copy, Eye, EyeOff, Loader2 } from "lucide-react"
import { useLocalCurrency, formatLocal } from "@/hooks/useLocalCurrency"
import { useAuth } from "@/hooks/useAuth"
import { useMpcWallet } from "@/hooks/useMpcWallet"
import { useTokenBalances } from "@/hooks/useTokenBalances"
import { CONTRACTS } from "@/lib/config"
import GlassSurface from "@/components/ui/glass-surface"
import GradientWaves from "@/components/ui/gradient-waves"
import BorderGlow from "@/components/ui/border-glow"
import SandTexture from "@/components/ui/sand-texture"

export default function BalanceCardSection() {
  const { isAuthenticated, user, wallet, isLoading } = useAuth()
  const { address } = useMpcWallet()
  const walletAddress = address ?? wallet?.address ?? null

  const { balances, isLoading: balancesLoading } = useTokenBalances(walletAddress)
  const [balanceVisible, setBalanceVisible] = useState(true)
  const [copied, setCopied] = useState(false)

  /**
   * The holder's own currency, resolved server-side from the country they signed up in — so a
   * Malaysian sees ringgit and a Filipino pesos, with nothing to pick.
   *
   * USDC stays the unit the card opens in and the one every flow actually moves; this is a
   * second reading of the same number, not a second balance. Both are now printed at once, one
   * under the other. They used to share a slot and swap when the figure was tapped, which hid
   * the answer to "what is that in rupiah" behind a gesture nothing on the card advertised.
   */
  const localCurrency = useLocalCurrency(isAuthenticated)

  // USDC is the isAuthenticated every Saku flow moves; mBUSD only appears as off-ramp settlement output,
  // so the headline figure is USDC rather than a sum that would drift as soon as a swap lands.
  const usdc = balances.find((t) => t.address.toLowerCase() === CONTRACTS.USDC.toLowerCase())
  const balanceUsdc = Number(usdc?.formatted ?? 0)
  const displayBalance = usdc
    ? balanceUsdc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00"

  // Null until the rate arrives, and null is what keeps the line absent rather than printing a
  // converted figure derived from a rate that is not there yet.
  const localBalance = formatLocal(balanceUsdc, localCurrency)

  const handleCopyAddress = async () => {
    if (!walletAddress) return
    await navigator.clipboard.writeText(walletAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="pt-2 sm:pt-4 animate-in fade-in slide-in-from-bottom-4 duration-500 font-sans">
      {/* React Bits' BorderGlow, in Saku's oranges, doing the job the plain `border-white/10`
          used to: it lights the edge nearest the pointer and sweeps once on mount. `animated` is
          left off — a rim that travels on its own would compete with the waves behind it, and
          the card is allowed one moving thing. */}
      <BorderGlow
        borderRadius={40}
        backgroundColor="#0A0A0A"
        glowColor="32 90 62"
        glowRadius={32}
        glowIntensity={0.9}
        colors={["#F0A353", "#FFD362", "#C97F1D"]}
        fillOpacity={0.45}
        className="w-full"
      >
      <div className="relative w-full rounded-[2.5rem] p-6 sm:p-7 text-white overflow-hidden transition-all duration-500 group">
        <div className="absolute inset-0 bg-[#0A0A0A]" />

        {/* React Bits' GradientWaves, recoloured to Saku's orange. These numbers were arrived at
            by looking, with the four candidates rendered side by side rather than guessed at. An
            earlier pass dimmed the waves to opacity 0.5 at brightness 0.6 in dark orange, which on
            a near-black card is indistinguishable from no waves at all.

            `tilt` and `height` are what decide how much of the card the light covers — raising
            both lifts the horizon, and 1.4/9 is where the glow reaches about two thirds of the
            way up. The top stays dark, which is where the balance sits. */}
        <div className="absolute inset-0 pointer-events-none">
          <GradientWaves
            className="h-full w-full"
            horizonColor="#1A0E04"
            waveColor="#F0A353"
            crestColor="#FFD362"
            speed={0.16}
            amplitude={2.4}
            brightness={1.25}
            opacity={1}
            tilt={1.4}
            height={9}
            detail="low"
            grain={false}
            mouseInteraction={false}
          />
        </div>

        {/* The surface itself. The waves give the card light; this gives it something for the
            light to fall on. Without it the gradient is just a gradient. */}
        <SandTexture opacity={0.3} grainSize={110} />

        <div className="relative h-full flex flex-col justify-between gap-5 z-10">
          {/* Band one: whose wallet this is, and nothing else. The credit-card chip that used
              to sit here said "card" on a screen nobody mistakes for anything else, and the chain
              chip that replaced it named a testnet to people who will never type a chain id. */}
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1 bg-white/5 rounded-lg backdrop-blur-sm border border-white/10 shrink-0">
              <img src="/logo.png" alt="" className="w-7 h-7 object-contain" />
            </div>
            <span className="font-bold tracking-tight text-lg bg-gradient-to-br from-white to-white/60 bg-clip-text text-transparent">
              Saku.
            </span>
          </div>

          {/* Band two: the figure. Both readings are on screen at once — the headline in USDC,
              the holder's own currency beneath it. They used to share one slot and swap on tap,
              which meant the answer to "how much is that in rupiah" was hidden behind a gesture
              nothing advertised.

              The eye sits against the number, not against the label. It hides the figure, so it
              belongs next to the figure; parked by the caption it read as a control over the
              words. */}
          <div className="space-y-1">
            <p className="text-[11px] font-semibold text-amber-500/90">Current balance</p>

            <div className="flex items-center gap-3">
              <h2 className="text-4xl sm:text-[2.75rem] font-bold tracking-tighter leading-none bg-gradient-to-b from-white to-white/70 bg-clip-text text-transparent">
                {balanceVisible ? `$ ${displayBalance}` : "$ ••••••"}
              </h2>
              <button
                onClick={() => setBalanceVisible(!balanceVisible)}
                aria-label={balanceVisible ? "Hide balance" : "Show balance"}
                className="p-1.5 shrink-0 hover:bg-white/10 rounded-lg transition-colors"
              >
                {balanceVisible ? (
                  <Eye className="w-4 h-4 text-white/40" />
                ) : (
                  <EyeOff className="w-4 h-4 text-white/40" />
                )}
              </button>
              {(balancesLoading || isLoading) && (
                <Loader2 className="w-5 h-5 animate-spin text-amber-500 shrink-0" />
              )}
            </div>

            {/* Absent rather than zeroed while the rate is still in flight. An exchange figure
                that reads 0 is worse than no figure: it looks like an answer. */}
            {localBalance && (
              <p className="text-sm text-white/40 font-medium">
                {balanceVisible ? `≈ ${localBalance}` : `≈ ${localCurrency?.symbol} ••••••`}
              </p>
            )}
          </div>

          {/* Band three: the two details worth reading off a card, weighted unevenly on purpose.

              The address gets a surface because it is the only thing here anyone interacts with —
              glass that refracts the moving mesh behind it, so the card's one animation shows
              through the one element you touch. The holder gets nothing; see below. */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* Upstream's own numbers, near enough. The previous settings had the refraction
                dialled down to a third of default and a tint over the top, which is why it read
                as a grey box rather than as glass: `backgroundOpacity` 0 means the panel has no
                colour of its own and is nothing but what it bends. */}
            <GlassSurface
              width="100%"
              height="100%"
              borderRadius={16}
              theme="dark"
              backgroundOpacity={0}
              blur={11}
              displace={0.6}
              distortionScale={-180}
              redOffset={0}
              greenOffset={10}
              blueOffset={20}
              className="min-w-0"
            >
              <div className="w-full min-w-0 px-1.5">
                <p className="text-[10px] text-white/45 font-medium mb-1">Wallet address</p>
                <div className="flex items-center gap-1.5">
                  <p className="font-mono text-[13px] tracking-tight text-amber-100/90 truncate">
                    {isLoading
                      ? "••••••••••"
                      : walletAddress
                        ? `${walletAddress.slice(0, 4)}••••${walletAddress.slice(-4)}`
                        : "No wallet"}
                  </p>
                  {walletAddress && (
                    <button
                      onClick={handleCopyAddress}
                      aria-label="Copy address"
                      className="p-0.5 shrink-0 hover:bg-white/10 rounded transition-all active:scale-90"
                    >
                      {copied ? (
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-white/40" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            </GlassSurface>

            {/* No surface. The address is data you copy, so it earns a box to point at; a name
                is just a name, and boxing it made the card read as two buttons. */}
            <div className="px-1.5 py-2.5 min-w-0 self-center text-right">
              <p className="text-[10px] text-white/35 font-medium mb-1">Holder</p>
              <p className="text-[13px] font-semibold truncate text-white/90">
                {user?.display_name || "Saku User"}
              </p>
            </div>
          </div>
        </div>
      </div>
      </BorderGlow>
    </div>
  )
}

"use client"

/**
 * "Main Services" — the six things this app is for.
 *
 * Each action is a tile that names itself and says what it does, rather than an icon with a
 * two-word caption under it. The icon grid was compact and unreadable: "Packet" and "Split Bill"
 * mean nothing to someone on their second visit, and a wallet is exactly the kind of app where
 * guessing wrong costs money. A line of description per tile is the cheapest possible fix.
 *
 * The heading lives outside this card now, in `SectionHeading`, so the section has a title
 * rather than a label printed inside the panel it names.
 *
 * Each action carries a `ready` flag. Features are being rebuilt one at a time, and a tile that
 * navigates to a route that does not exist yet is worse than one that says it is coming.
 *
 * ## How the section is built up
 *
 * The shell is `GlowCard`, which every panel in the app now shares — a rim that lights up
 * nearest the pointer over a slow warm tint. `animated` is on here and nowhere else: this is
 * the only card on its screen, so the mount sweep has nothing to compete with.
 *
 * ## Why the tiles are plain
 *
 * Three revisions of this section tried to make them glass, and the notes are here so the fourth
 * does not start over:
 *
 *  - React Bits' `GlassSurface` is what the balance card's wallet address panel uses, and over
 *    near-black with waves moving under it, it is the better thing by a distance. Over a pale
 *    card it is not. Its filter comes back muted and a stop darker than what it sampled, which
 *    is invisible on a dark backdrop and is the whole problem on a light one.
 *  - A `GlassSurface` wrapped in a `BorderGlow` does not refract at all. The ring's own layers
 *    blend, which makes it a backdrop root, so the glass inside samples the ring's empty
 *    interior instead of the card — six flat grey rectangles, every time, at any settings.
 *  - The same applies to nesting: a backdrop filter cuts off every backdrop filter inside it, so
 *    a glass pane wrapping the tiles blanks them just as thoroughly.
 *
 * What is here instead is what the brief actually asked for — modern and clean. A hairline, a
 * mostly-white fill that lets the tint whisper through, a rounded corner, and nothing else. No
 * shadows: six tiles each casting their own, inside a card casting another, is seven sources of
 * depth in one block, which reads as grime rather than as lift. `shadow-none!` on the shell is
 * there for the same reason, since the component ships a drop shadow sized for a dark card.
 *
 * It also costs a border and a background colour. The tiles were React Bits' SpecularButton for
 * one revision, which meant six WebGL contexts and six animation loops on the most-visited
 * screen in the app; the glass revisions meant seven SVG filter graphs. Nothing in this section
 * runs a loop now except the aurora, and that one animates transforms only.
 *
 * ## SCALE
 *
 * Every measurement here is `clamp(floor, N vw, desktop)` instead of a `sm:` pair. The reason is
 * that the app column is `max-w-lg`, so it stops growing at a 512px viewport: below that the
 * column *is* the viewport, so `vw` tracks the column exactly, and above it every clamp is
 * already pinned to its desktop value. One design, drawn at whatever size the column happens
 * to be, rather than a roomy design and a cramped one swapping over at 640px.
 *
 * The middle term is always `desktop / 5.12` vw, which is what makes it land on the desktop
 * value at 512px.
 *
 * The floors are not all on the same ratio, and that is the part that was tuned by looking at a
 * real phone rather than calculated. A first pass floored everything near 0.76 of its desktop
 * value, which on a 360px screen made the icon the biggest thing in a 99px tile while the two
 * lines of text underneath it wrapped and clipped. The tile read as an icon with some debris
 * under it. So the icon falls further than the rest, to 28px against 44px, and the text falls
 * less: the room the icon gives up is exactly the room "To a phone number" needs to stay on one
 * line. Nothing here is allowed below 8px.
 */

import { useRouter } from "next/navigation"
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Gift, Send, TrendingUp, Users2 } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useMpcWallet } from "@/hooks/useMpcWallet"
import SectionHeading from "@/components/home/section-heading"
import GlowCard from "@/components/ui/glow-card"

interface QuickAction {
  id: string
  label: string
  /** One line, plain verb first, saying what the tile actually does. */
  description: string
  icon: React.ElementType
  color: string
  href: string
  ready: boolean
}

// QR Pay is deliberately absent: it is the raised button in the middle of the nav bar, and
// listing it here too would be the same action twice on one screen.
const quickActions: QuickAction[] = [
  { id: "topup", label: "Top Up", description: "Add money", icon: ArrowDownLeft, color: "bg-orange-100 text-[#F0A353]", href: "/topup", ready: true },
  { id: "transfer", label: "Transfer", description: "To a phone number", icon: Send, color: "bg-blue-100 text-blue-600", href: "/transfer", ready: true },
  { id: "packet", label: "Packet", description: "Send a gift", icon: Gift, color: "bg-red-100 text-red-600", href: "/packet", ready: true },
  { id: "split-bill", label: "Split Bill", description: "Share a cost", icon: Users2, color: "bg-purple-100 text-purple-600", href: "/split-bill", ready: true },
  { id: "withdraw", label: "Withdraw", description: "To your bank", icon: ArrowUpRight, color: "bg-slate-200 text-slate-600", href: "/offramp", ready: true },
  { id: "staking", label: "Earn", description: "Grow your balance", icon: TrendingUp, color: "bg-teal-100 text-teal-600", href: "/staking", ready: true },
]

export default function QuickActions() {
  const router = useRouter()
  const { wallet, isLoading } = useAuth()
  const { address } = useMpcWallet()

  const walletAddress = address ?? wallet?.address ?? null

  return (
    <section className="animate-in fade-in slide-in-from-bottom-4 duration-500 font-sans">
      {/* No "see all" here, deliberately. All six services are on screen — a link promising
          more would lead to the same six, and a control that does nothing is worse than a
          heading that simply ends. */}
      <SectionHeading title="Main Services" />

      <GlowCard animated className="p-[clamp(8px,2.34vw,12px)]">
        {/* Three across at every width, so the section reads the same on a phone as on a
            desktop. It used to fall to two below 640px, which reflowed six tiles from two rows
            into three — the one place in the app where the layout changed shape at all.
            Every size below is a `clamp` rather than a breakpoint, for the reason in the
            SCALE note at the top of the file: one design, drawn smaller when the column is
            narrower, instead of two designs that swap over at 640px. */}
        <div className="grid w-full grid-cols-3 gap-[clamp(6px,1.95vw,10px)]">
        {quickActions.map((action) => {
          const Icon = action.icon
          const disabled = !walletAddress || isLoading || !action.ready

          return (
            <button
              key={action.id}
              onClick={() => router.push(action.href)}
              disabled={disabled}
              title={!action.ready ? "Coming soon" : undefined}
              className="group flex min-w-0 flex-col items-start gap-[clamp(7px,2.34vw,12px)] rounded-[clamp(12px,3.52vw,18px)] border border-black/[0.10] bg-white/70 p-[clamp(8px,2.34vw,12px)] text-left transition-[background-color,border-color,transform] duration-200 hover:border-black/[0.18] hover:bg-white/90 active:scale-[0.98] disabled:opacity-40 disabled:hover:border-black/[0.10] disabled:hover:bg-white/70 disabled:active:scale-100"
            >
              <span
                className={`w-[clamp(28px,8.59vw,44px)] h-[clamp(28px,8.59vw,44px)] rounded-[clamp(10px,3.13vw,16px)] ${action.color} flex items-center justify-center transition-transform duration-300 group-enabled:group-hover:-translate-y-0.5`}
              >
                <Icon className="w-[clamp(14px,4.30vw,22px)] h-[clamp(14px,4.30vw,22px)]" strokeWidth={2.5} />
              </span>

              <span className="block w-full min-w-0">
                <span className="flex items-center gap-[clamp(2px,0.78vw,4px)]">
                  <span className="text-[length:clamp(10px,2.54vw,13px)] font-bold text-slate-900 truncate">
                    {action.label}
                  </span>
                  {/* Decorative — the whole tile is the button. It shrinks with everything else
                      rather than disappearing below 640px, which is what used to make the phone
                      and the desktop draw a different tile. */}
                  <ChevronRight className="w-[clamp(9px,2.73vw,14px)] h-[clamp(9px,2.73vw,14px)] shrink-0 text-black/25 transition-transform group-enabled:group-hover:translate-x-0.5" />
                </span>
                {/* Room to breathe between the name and the line under it. They were a
                    half-step apart and read as one wrapped sentence. */}
                {/* Wraps rather than truncates: "To a phone number" does not fit one 80px line,
                    and a clipped half-sentence is worse than two short ones. Grid rows stretch
                    together, so a two-line tile does not break the row. */}
                <span className="block text-[length:clamp(8px,1.95vw,10px)] leading-tight text-black/45 line-clamp-2">
                  {action.description}
                </span>
              </span>
            </button>
          )
        })}
        </div>
      </GlowCard>
    </section>
  )
}

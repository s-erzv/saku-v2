"use client"

/**
 * Home, in the web wallet.
 *
 * The balance card leads, at the size of a hero, because it is the one thing on this screen with
 * any movement in it and the thing people open a wallet to look at. Beside it, the two questions
 * that follow — what happened lately, and what the balance is earning — each in a plain panel
 * that defers to the card. Under them, anything addressed to you that needs an answer, three
 * featured services, then the full tool set. Tools open in the panel rather than leaving Home.
 *
 * The first-run pieces are the app's own (`OnboardingSlider`, `RecoveryGate`, `WalletSetup`).
 * `WalletSetup` in particular is what derives the wallet on a first sign-in, so the web Home must
 * carry it exactly as the app's does.
 *
 * Columns follow the width of this page, not the window: opening the tool panel narrows the page,
 * and the grid should answer to that.
 */

import { useEffect } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowDownLeft, ArrowUpRight, CaretRight, ChartLineUp, Gift, PaperPlaneTilt, type Icon } from "@phosphor-icons/react"
import { Loader2 } from "lucide-react"
import { useStaking } from "@/hooks/useStaking"
import { useTransactions } from "@/hooks/useTransactions"
import { describeTransaction } from "@/lib/receipt-content"
import BalanceCardSection from "@/components/home/balance-card-section"
import BillsToPay from "@/components/home/bills-to-pay"
import GuardianRequests from "@/components/home/guardian-requests"
import OnboardingSlider from "@/components/home/onboarding-slider"
import { formatAmount, formatWhen } from "@/components/home/recent-transactions"
import RecoveryGate from "@/components/home/recovery-gate"
import WaitingPackets from "@/components/home/waiting-packets"
import WalletSetup from "@/components/home/wallet-setup"
import IconTile from "@/components/ui/icon-tile"
import { GradientBackground } from "@/components/ui/noisy-gradient-backgrounds"
import { RECEIVE, TOOLS, useWebShell } from "@/components/web/shell"

const FEATURED_SERVICES = [
  {
    id: "transfer" as const,
    label: "Transfer",
    title: "Send USDC",
    accent: "with a phone number",
    icon: PaperPlaneTilt,
    dark: false,
    gradient:
      "radial-gradient(115% 155% at 100% 0%,#C98A24 0%,#E5B44F 24%,#EED28A 49%,#D7C2A1 74%,#B8A58E 100%)",
  },
  {
    id: "earn" as const,
    label: "Earn",
    title: "Stake your USDC",
    accent: "let your balance grow",
    icon: ChartLineUp,
    dark: true,
    gradient:
      "radial-gradient(125% 165% at 100% 0%,#F2CB73 0%,#9A6B20 24%,#3A2B16 53%,#17140F 82%,#0F0E0B 100%)",
  },
  {
    id: "packet" as const,
    label: "Packet",
    title: "Send a surprise",
    accent: "open, smile, claim",
    icon: Gift,
    dark: false,
    gradient:
      "radial-gradient(125% 165% at 0% 100%,#B96F10 0%,#DE9E29 24%,#F0C766 48%,#D9BA86 73%,#A89983 100%)",
  },
]

export default function WebHome() {
  const shell = useWebShell()
  const version = shell?.version ?? 0

  return (
    <div className="@container mx-auto w-full max-w-[1240px] px-4 py-6 font-sans sm:px-6 lg:px-8 lg:py-8">
      <OnboardingSlider />
      <RecoveryGate />
      <h1 className="sr-only">Home</h1>

      <div className="grid gap-4 @3xl:grid-cols-2 @5xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="@3xl:col-span-2 @5xl:col-span-1">
          <BalanceCardSection className="h-full" refreshKey={version} />
        </div>
        <RecentActivity refreshKey={version} />
        <EarnSummary refreshKey={version} />
      </div>

      {/* Renders nothing once the wallet is up. */}
      <div className="mt-4 empty:hidden">
        <WalletSetup />
      </div>

      {/* Each renders nothing unless something is actually waiting, so a settled account skips
          straight from the panels to the services. */}
      <div className="mt-10 grid items-start gap-x-6 gap-y-8 @3xl:grid-cols-2 empty:hidden">
        <GuardianRequests />
        <WaitingPackets />
        <BillsToPay />
      </div>

      <FeaturedServices />

      <section className="mt-10" aria-labelledby="services-title">
        <h2 id="services-title" className="text-[20px] font-semibold tracking-tight">
          Services
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-3 @2xl:grid-cols-4">
          {TOOLS.map((tool) => (
            <ServiceCard
              key={tool.id}
              icon={tool.icon}
              label={tool.label}
              description={tool.description}
              expanded={shell?.activeTool === tool.id}
              onClick={() => shell?.openTool(tool.id)}
            />
          ))}
          <ServiceCard
            icon={RECEIVE.icon}
            label={RECEIVE.label}
            description={RECEIVE.description}
            onClick={() => shell?.openReceive()}
          />
        </div>
      </section>
    </div>
  )
}

function FeaturedServices() {
  const shell = useWebShell()

  return (
    <section className="mt-10" aria-labelledby="featured-services-title">
      <div className="relative flex min-h-[84px] items-end pr-28 @2xl:min-h-[92px] @2xl:pr-36">
        <div>
          <h2 id="featured-services-title" className="text-[20px] font-semibold tracking-tight">
            Saku essentials
          </h2>
          <p className="mt-1 text-[13px] text-black/45">Three simple ways to move and grow your money.</p>
        </div>
        <Image
          src="/hamster-headphone.png"
          alt=""
          width={1254}
          height={1254}
          sizes="(min-width: 672px) 140px, 112px"
          className="pointer-events-none absolute -bottom-5 right-1 z-20 h-28 w-28 object-contain object-bottom drop-shadow-[0_10px_16px_rgb(40_27_10/0.12)] @2xl:-bottom-6 @2xl:right-3 @2xl:h-36 @2xl:w-36"
        />
      </div>

      <div className="mt-3 grid snap-x snap-mandatory auto-cols-[88%] grid-flow-col gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden @2xl:grid-flow-row @2xl:grid-cols-3 @2xl:overflow-visible @2xl:pb-0">
        {FEATURED_SERVICES.map((feature) => {
          const Glyph = feature.icon
          const active = shell?.activeTool === feature.id
          return (
            <button
              key={feature.id}
              type="button"
              aria-expanded={active}
              onClick={() => shell?.openTool(feature.id)}
              className={`group relative min-h-[190px] snap-start overflow-hidden rounded-[24px] border p-5 text-left transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] ${
                feature.dark
                  ? "border-white/10 text-white shadow-[0_16px_36px_rgb(42_30_12/0.18)]"
                  : "border-black/[0.06] text-ink shadow-[0_14px_34px_rgb(86_57_13/0.10)]"
              } ${active ? "ring-2 ring-gilt/65" : ""}`}
            >
              <GradientBackground
                customGradient={feature.gradient}
                noisePatternSize={84}
                noisePatternAlpha={18}
                noiseIntensity={0.55}
              />

              <span className="relative z-10 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em]">
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-[9px] ${
                    feature.dark ? "bg-white/12 text-[#F6D889]" : "bg-black/[0.07] text-[#8A5912]"
                  }`}
                >
                  <Glyph size={15} weight="bold" />
                </span>
                <span className={feature.dark ? "text-white/65" : "text-black/50"}>{feature.label}</span>
              </span>

              <span className="relative z-10 mt-12 block pr-8">
                <span className="block text-[20px] font-semibold leading-tight tracking-[-0.02em]">{feature.title}</span>
                <span className={`mt-0.5 block text-[20px] font-semibold leading-tight tracking-[-0.02em] ${feature.dark ? "text-[#F5D47E]" : "text-[#A7680D]"}`}>
                  {feature.accent}
                </span>
              </span>

              <span
                className={`absolute bottom-4 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full transition-transform group-hover:translate-x-0.5 ${
                  feature.dark ? "bg-white/10 text-[#F5D47E]" : "bg-white/70 text-[#9A620F] shadow-sm"
                }`}
              >
                <CaretRight size={16} weight="bold" />
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function ServiceCard({
  icon,
  label,
  description,
  expanded,
  onClick,
}: {
  icon: Icon
  label: string
  description: string
  expanded?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-expanded={expanded}
      className={`flex cursor-pointer flex-col items-start gap-5 rounded-[20px] border bg-white p-4 text-left transition-[transform,border-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgb(20_18_14/0.07)] active:translate-y-0 active:scale-[0.99] ${
        expanded ? "border-black/30 shadow-[0_10px_28px_rgb(20_18_14/0.07)]" : "border-black/[0.06] hover:border-black/15"
      }`}
    >
      <IconTile icon={icon} box="h-11 w-auto" />
      <span className="block">
        <span className="block text-[15px] font-medium tracking-tight">{label}</span>
        <span className="mt-0.5 block text-[13px] text-black/50">{description}</span>
      </span>
    </button>
  )
}

function RecentActivity({ refreshKey }: { refreshKey: number }) {
  const router = useRouter()
  const { transactions, isLoading, refresh } = useTransactions(5)

  useEffect(() => {
    if (refreshKey > 0) void refresh()
  }, [refreshKey, refresh])

  return (
    <section className="flex min-h-[320px] flex-col rounded-[24px] border border-black/[0.06] bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">Recent activity</h2>
        <Link href="/transactions" className="text-[13px] font-medium text-black/45 transition-colors hover:text-ink">
          View all
        </Link>
      </div>

      {isLoading && transactions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-black/20" />
        </div>
      ) : transactions.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="text-sm font-medium text-black/60">Nothing here yet</p>
          <p className="mt-1 max-w-[230px] text-[13px] text-black/40">Your transfers and packets will show up here.</p>
        </div>
      ) : (
        <ul className="-mx-2 mt-3">
          {transactions.map((tx) => {
            const incoming = tx.direction === "in"
            const { label } = describeTransaction(tx)
            return (
              <li key={tx.txHash}>
                {/* Same hand-off as the app: History, with this receipt already open. */}
                <button
                  onClick={() => router.push(`/transactions?tx=${tx.txHash}`)}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-black/[0.03]"
                >
                  <IconTile icon={incoming ? ArrowDownLeft : ArrowUpRight} tone="soft" size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{label}</span>
                    <span className="block truncate text-[12px] text-black/45">
                      {tx.counterpartyName ?? (incoming ? "Received" : "Sent")}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={`block text-[14px] font-semibold tabular-nums ${incoming ? "text-positive" : "text-ink"}`}>
                      {incoming ? "+" : "−"}
                      {formatAmount(tx.amount)}
                    </span>
                    <span className="block text-[12px] tabular-nums text-black/40">{formatWhen(tx.occurredAt)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** Staking figures arrive as full-precision strings; rewards can be fractions of a cent. */
function formatStake(value: string | undefined, maxDecimals = 2) {
  const n = Number(value ?? 0)
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxDecimals,
  })
}

function EarnSummary({ refreshKey }: { refreshKey: number }) {
  const shell = useWebShell()
  const { info, isLoading, refresh } = useStaking()

  useEffect(() => {
    if (refreshKey > 0) void refresh()
  }, [refreshKey, refresh])

  const hasStake = Number(info?.staked ?? 0) > 0

  return (
    <section className="flex min-h-[320px] flex-col rounded-[24px] border border-black/[0.06] bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">Earn</h2>
        <span className="text-[13px] text-black/45">USDC staking</span>
      </div>

      <p className="mt-6 text-[13px] text-black/50">Current APY</p>
      <p className="mt-1.5 text-[40px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
        {isLoading && !info ? "—" : `${info?.apy ?? "0.00"}${info?.apyCapped ? "%+" : "%"}`}
      </p>

      <dl className="mt-6 space-y-2.5 border-t border-black/[0.06] pt-4 text-[14px]">
        <div className="flex justify-between gap-3">
          <dt className="text-black/50">You staked</dt>
          <dd className="font-medium tabular-nums">{formatStake(info?.staked)} USDC</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-black/50">Earned</dt>
          <dd className="font-medium tabular-nums">{formatStake(info?.pending, 6)} USDC</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-black/50">Pool total</dt>
          <dd className="font-medium tabular-nums">{formatStake(info?.totalStaked)} USDC</dd>
        </div>
      </dl>

      <div className="mt-auto pt-5">
        <button
          onClick={() => shell?.openTool("earn")}
          className="w-full rounded-full bg-black py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          {hasStake ? "Manage stake" : "Start earning"}
        </button>
      </div>
    </section>
  )
}

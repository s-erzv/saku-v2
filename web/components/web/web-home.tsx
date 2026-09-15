"use client"

/**
 * Home, in the web wallet.
 *
 * The balance card leads, at the size of a hero, because it is the one thing on this screen with
 * any movement in it and the thing people open a wallet to look at. Beside it, the two questions
 * that follow — what happened lately, and what the balance is earning — each in a plain panel
 * that defers to the card. Under them, anything addressed to you that needs an answer, then every
 * service, which open in the tool panel rather than taking you off Home.
 *
 * The first-run pieces are the app's own (`OnboardingSlider`, `RecoveryGate`, `WalletSetup`).
 * `WalletSetup` in particular is what derives the wallet on a first sign-in, so the web Home must
 * carry it exactly as the app's does.
 *
 * Columns follow the width of this page, not the window: opening the tool panel narrows the page,
 * and the grid should answer to that.
 */

import { useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowDownLeft, ArrowUpRight, type Icon } from "@phosphor-icons/react"
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
import { RECEIVE, TOOLS, useWebShell } from "@/components/web/shell"

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
      className={`flex flex-col items-start gap-5 rounded-[20px] border bg-white p-4 text-left transition-colors ${
        expanded ? "border-black/30" : "border-black/[0.06] hover:border-black/15"
      }`}
    >
      <IconTile icon={icon} />
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

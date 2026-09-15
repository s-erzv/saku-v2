"use client"

/**
 * History, in the web wallet.
 *
 * The data, the `?tx=` hand-off from Home and the receipt all stay in `app/transactions/page.tsx`;
 * this is only the layout. A desktop gets what a phone cannot fit: the card beside a summary, and
 * the list as a table with the date and status in columns of their own rather than folded into a
 * subtitle. Narrow tabs still get rows, because a five-column table on a phone is a sideways
 * scroll.
 *
 * The totals are labelled with how many transactions they cover. The list loads the latest fifty,
 * and a sum that quietly stops at fifty must not read as a lifetime figure.
 */

import { useMemo, useState } from "react"
import { formatUnits } from "ethers"
import { ArrowDownLeft, ArrowUpRight, PaperPlaneTilt, QrCode } from "@phosphor-icons/react"
import { Loader2 } from "lucide-react"
import type { SakuTransaction } from "@/hooks/useTransactions"
import { STATUS_LABEL, USDC_DECIMALS, describeTransaction } from "@/lib/receipt-content"
import { formatAmount } from "@/components/home/recent-transactions"
import BalanceCardSection from "@/components/home/balance-card-section"
import IconTile from "@/components/ui/icon-tile"
import { useWebShell } from "@/components/web/shell"

type Filter = "all" | "in" | "out"

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "in", label: "Money in" },
  { id: "out", label: "Money out" },
]

const STATUS_DOT: Record<SakuTransaction["status"], string> = {
  confirmed: "bg-positive",
  pending: "bg-gilt",
  reverted: "bg-negative",
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
}

function toUsdc(amount: string | null) {
  if (!amount) return 0
  try {
    return Number(formatUnits(amount, USDC_DECIMALS))
  } catch {
    return 0
  }
}

interface WebActivityProps {
  transactions: SakuTransaction[]
  loading: boolean
  onOpen: (tx: SakuTransaction) => void
}

export default function WebActivity({ transactions, loading, onOpen }: WebActivityProps) {
  const shell = useWebShell()
  const [filter, setFilter] = useState<Filter>("all")

  const rows = filter === "all" ? transactions : transactions.filter((tx) => tx.direction === filter)

  // Confirmed only. A pending row may still revert, and a reverted one moved nothing.
  const totals = useMemo(() => {
    let moneyIn = 0
    let moneyOut = 0
    for (const tx of transactions) {
      if (tx.status !== "confirmed") continue
      if (tx.direction === "in") moneyIn += toUsdc(tx.amount)
      else moneyOut += toUsdc(tx.amount)
    }
    return { moneyIn, moneyOut }
  }, [transactions])

  const usd = (value: number) =>
    value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="@container mx-auto w-full max-w-[1240px] px-4 py-6 font-sans sm:px-6 lg:px-8 lg:py-8">
      <div className="grid gap-4 @4xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <BalanceCardSection className="h-full" />

        <section className="flex flex-col rounded-[24px] border border-black/[0.06] bg-white p-6">
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight">Activity</h1>
          <p className="mt-1.5 text-sm text-black/50">
            Everything that moved through your wallet, newest first.
          </p>

          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-black/[0.06] pt-5">
            <div>
              <dt className="text-[13px] text-black/50">Money in</dt>
              <dd className="mt-1 text-[24px] font-semibold tracking-tight tabular-nums text-positive">
                +{usd(totals.moneyIn)}
              </dd>
            </div>
            <div>
              <dt className="text-[13px] text-black/50">Money out</dt>
              <dd className="mt-1 text-[24px] font-semibold tracking-tight tabular-nums">
                −{usd(totals.moneyOut)}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-[12px] text-black/40">
            USDC, across your latest {transactions.length} {transactions.length === 1 ? "transaction" : "transactions"}
          </p>

          <div className="mt-auto flex flex-wrap gap-2 pt-6">
            <button
              onClick={() => shell?.openReceive()}
              className="flex items-center gap-2 rounded-full border border-black/10 px-4 py-2.5 text-sm font-medium transition-colors hover:border-black/25"
            >
              <QrCode size={17} />
              Receive
            </button>
            <button
              onClick={() => shell?.openTool("transfer")}
              className="flex items-center gap-2 rounded-full bg-black px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              <PaperPlaneTilt size={17} />
              Transfer
            </button>
          </div>
        </section>
      </div>

      <section className="mt-6 overflow-hidden rounded-[24px] border border-black/[0.06] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-5">
          <h2 className="text-[15px] font-semibold tracking-tight">Transactions</h2>
          <div role="tablist" aria-label="Filter transactions" className="flex rounded-full bg-black/[0.04] p-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                  filter === f.id ? "bg-white text-ink shadow-[0_1px_2px_rgb(20_18_14/0.08)]" : "text-black/50 hover:text-ink"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {loading && transactions.length === 0 ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-black/20" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-20 text-center">
            <p className="text-sm font-medium text-black/60">
              {transactions.length === 0 ? "No transactions yet" : "Nothing in this view"}
            </p>
            <p className="mt-1 text-[13px] text-black/40">
              {transactions.length === 0
                ? "Top up or receive USDC and it will show up here."
                : "Try another filter."}
            </p>
          </div>
        ) : (
          <>
            {/* Wide: a table. */}
            <table className="hidden w-full text-left @2xl:table">
              <thead>
                <tr className="text-[12px] text-black/45">
                  <th className="px-5 py-2.5 font-medium">Transaction</th>
                  <th className="px-3 py-2.5 font-medium">With</th>
                  <th className="px-3 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((tx) => {
                  const incoming = tx.direction === "in"
                  const { label, detail } = describeTransaction(tx)
                  return (
                    <tr
                      key={tx.txHash}
                      onClick={() => onOpen(tx)}
                      className="cursor-pointer border-t border-black/[0.05] transition-colors hover:bg-black/[0.02]"
                    >
                      <td className="px-5 py-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onOpen(tx)
                          }}
                          className="flex items-center gap-3 rounded-lg text-left outline-offset-4"
                        >
                          <IconTile icon={incoming ? ArrowDownLeft : ArrowUpRight} tone="soft" size="sm" />
                          <span className="min-w-0">
                            <span className="block text-[14px] font-medium">{label}</span>
                            {detail && <span className="block text-[12px] text-black/45">{detail}</span>}
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-3 text-[14px] text-black/65">
                        {tx.counterpartyName ?? (incoming ? "Received" : "Sent")}
                      </td>
                      <td className="px-3 py-3 text-[14px] tabular-nums text-black/65">
                        {formatDate(tx.occurredAt)}
                        <span className="block text-[12px] text-black/40">{formatTime(tx.occurredAt)}</span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="inline-flex items-center gap-1.5 text-[13px] text-black/60">
                          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[tx.status]}`} />
                          {STATUS_LABEL[tx.status]}
                        </span>
                      </td>
                      <td
                        className={`px-5 py-3 text-right text-[14px] font-semibold tabular-nums ${
                          incoming ? "text-positive" : "text-ink"
                        }`}
                      >
                        {incoming ? "+" : "−"}
                        {formatAmount(tx.amount)} <span className="font-normal text-black/40">USDC</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Narrow: rows. */}
            <ul className="@2xl:hidden">
              {rows.map((tx) => {
                const incoming = tx.direction === "in"
                const { label } = describeTransaction(tx)
                return (
                  <li key={tx.txHash} className="border-t border-black/[0.05]">
                    <button
                      onClick={() => onOpen(tx)}
                      className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-black/[0.02]"
                    >
                      <IconTile icon={incoming ? ArrowDownLeft : ArrowUpRight} tone="soft" size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium">{tx.counterpartyName ?? label}</span>
                        <span className="block truncate text-[12px] text-black/45">
                          {tx.counterpartyName ? `${label} · ` : ""}
                          {formatDate(tx.occurredAt)}
                          {tx.status !== "confirmed" && ` · ${STATUS_LABEL[tx.status]}`}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 text-[14px] font-semibold tabular-nums ${incoming ? "text-positive" : "text-ink"}`}
                      >
                        {incoming ? "+" : "−"}
                        {formatAmount(tx.amount)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}

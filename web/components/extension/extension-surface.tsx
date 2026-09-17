"use client"

import dynamic from "next/dynamic"
import Image from "next/image"
import { useMemo, useState, type ComponentType } from "react"
import {
  ArrowDownLeft,
  ArrowSquareOut,
  ArrowUpRight,
  Bank,
  CaretRight,
  ChartLineUp,
  Copy,
  CreditCard,
  Gift,
  PaperPlaneTilt,
  QrCode,
  Receipt,
  Scan,
  type Icon,
} from "@phosphor-icons/react"
import { Check, Loader2 } from "lucide-react"
import { formatUnits } from "ethers"
import ExtensionLogin from "@/components/extension/extension-login"
import ReceiveDialog from "@/components/web/receive-dialog"
import { InPanelContext, WebShellContext, type ToolId, type WebShell } from "@/components/web/shell"
import { useAuth } from "@/hooks/useAuth"
import { useLocalCurrency, formatLocal } from "@/hooks/useLocalCurrency"
import { useMpcWallet } from "@/hooks/useMpcWallet"
import { useTokenBalances } from "@/hooks/useTokenBalances"
import { useTransactions, type SakuTransaction } from "@/hooks/useTransactions"
import { CONTRACTS, explorerAddressUrl } from "@/lib/config"

const TransferPage = dynamic(() => import("@/app/transfer/page"), { loading: LoadingPanel })
const TopupPage = dynamic(() => import("@/app/topup/page"), { loading: LoadingPanel })
const WithdrawPage = dynamic(() => import("@/app/offramp/page"), { loading: LoadingPanel })
const PacketPage = dynamic(() => import("@/app/packet/page"), { loading: LoadingPanel })
const SplitBillPage = dynamic(() => import("@/app/split-bill/page"), { loading: LoadingPanel })
const EarnPage = dynamic(() => import("@/app/staking/page"), { loading: LoadingPanel })
const PaySheet = dynamic(() => import("@/components/pay/pay-sheet"), { loading: LoadingPanel })

type ExtensionView = ToolId

const PAGES: Record<Exclude<ToolId, "pay">, ComponentType> = {
  transfer: TransferPage,
  topup: TopupPage,
  withdraw: WithdrawPage,
  packet: PacketPage,
  "split-bill": SplitBillPage,
  earn: EarnPage,
}

const PRIMARY_ACTIONS: { id: ExtensionView | "receive"; label: string; icon: Icon }[] = [
  { id: "topup", label: "Top up", icon: CreditCard },
  { id: "transfer", label: "Send", icon: PaperPlaneTilt },
  { id: "withdraw", label: "Withdraw", icon: Bank },
  { id: "receive", label: "Receive", icon: QrCode },
]

const SERVICES: { id: ExtensionView; label: string; detail: string; icon: Icon }[] = [
  { id: "pay", label: "Pay", detail: "Scan or show a code", icon: Scan },
  { id: "packet", label: "Packet", detail: "Send or open a gift", icon: Gift },
  { id: "split-bill", label: "Split bill", detail: "Share a cost", icon: Receipt },
  { id: "earn", label: "Earn", detail: "Stake your USDC", icon: ChartLineUp },
]

function LoadingPanel() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#0B0B09] text-[#E8C96F]">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  )
}

function shortAddress(address: string | null) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Setting up..."
}

function displayBalance(value: string | undefined) {
  const number = Number(value ?? 0)
  return Number.isFinite(number)
    ? number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00"
}

function transactionLabel(transaction: SakuTransaction) {
  if (transaction.type === "transfer") return transaction.direction === "in" ? "Received USDC" : "Sent USDC"
  if (transaction.type === "topup") return "Top up"
  if (transaction.type === "stake") return "Staked USDC"
  if (transaction.type === "unstake") return "Unstaked USDC"
  if (transaction.type === "stake_reward") return "Claimed rewards"
  if (transaction.type === "qr_payment") return "Payment"
  return transaction.direction === "in" ? "Received USDC" : "Withdrawal"
}

function transactionAmount(transaction: SakuTransaction) {
  if (!transaction.amount) return "-"
  try {
    return Number(formatUnits(transaction.amount, 6)).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  } catch {
    return "-"
  }
}

function relativeDate(value: string) {
  const delta = Date.now() - new Date(value).getTime()
  if (delta < 60_000) return "Now"
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`
  return `${Math.floor(delta / 86_400_000)}d ago`
}

export default function ExtensionSurface() {
  const { user, wallet, isAuthenticated, isLoading } = useAuth()
  const { address } = useMpcWallet()
  const [view, setView] = useState<ExtensionView | null>(null)
  const [receiving, setReceiving] = useState(false)
  const [version, setVersion] = useState(0)
  const walletAddress = address ?? wallet?.address ?? null

  const shell = useMemo<WebShell>(
    () => ({
      activeTool: view,
      version,
      openTool: (tool) => setView(tool),
      closeTool: () => {
        setView(null)
        setVersion((current) => current + 1)
      },
      openReceive: () => setReceiving(true),
    }),
    [view, version]
  )

  if (isLoading) return <LoadingPanel />
  if (!isAuthenticated || !user) return <ExtensionLogin />

  return (
    <WebShellContext.Provider value={shell}>
      <InPanelContext.Provider value={view !== null}>
        {view ? (
          <ExtensionFeature view={view} onClose={shell.closeTool} />
        ) : (
          <ExtensionHome
            userName={user.display_name}
            walletAddress={walletAddress}
            onOpen={(next) => {
              if (next === "receive") setReceiving(true)
              else setView(next)
            }}
          />
        )}
        {receiving && <ReceiveDialog address={walletAddress} onClose={() => setReceiving(false)} />}
      </InPanelContext.Provider>
    </WebShellContext.Provider>
  )
}

function ExtensionFeature({ view, onClose }: { view: ExtensionView; onClose: () => void }) {
  if (view === "pay") {
    return (
      <div className="min-h-dvh bg-white">
        <PaySheet open variant="inline" onClose={onClose} />
      </div>
    )
  }

  const Page = PAGES[view]
  return <Page />
}

function ExtensionHome({
  userName,
  walletAddress,
  onOpen,
}: {
  userName: string | null
  walletAddress: string | null
  onOpen: (view: ExtensionView | "receive") => void
}) {
  const { balances, isLoading: balancesLoading } = useTokenBalances(walletAddress)
  const { transactions, isLoading: transactionsLoading } = useTransactions(3)
  const localCurrency = useLocalCurrency(true)
  const [copied, setCopied] = useState(false)
  const usdc = balances.find((token) => token.address.toLowerCase() === CONTRACTS.USDC.toLowerCase())
  const balance = displayBalance(usdc?.formatted)
  const localBalance = formatLocal(Number(usdc?.formatted ?? 0), localCurrency)
  const displayName = userName?.trim() || "Saku account"

  const copy = async () => {
    if (!walletAddress) return
    await navigator.clipboard.writeText(walletAddress)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <main className="min-h-dvh bg-[#0B0B09] px-3 py-3 text-white">
      <div className="mx-auto max-w-[420px]">
        <header className="flex items-center justify-between px-2 pb-5 pt-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <Image src="/icons/saku-mark.png" alt="" width={32} height={32} className="shrink-0 rounded-lg" />
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold tracking-tight">{displayName}</p>
              <button onClick={copy} className="flex items-center gap-1 text-[11px] text-white/48 transition-colors hover:text-white/80" title={walletAddress ?? undefined}>
                {shortAddress(walletAddress)}
                {copied ? <Check size={12} className="text-[#E8C96F]" /> : <Copy size={12} />}
              </button>
            </div>
          </div>
          {walletAddress && (
            <a
              href={explorerAddressUrl(walletAddress)}
              target="_blank"
              rel="noreferrer"
              aria-label="Open address in BscScan"
              className="rounded-xl p-2 text-white/50 transition-colors hover:bg-white/[0.07] hover:text-white"
            >
              <ArrowSquareOut size={18} />
            </a>
          )}
        </header>

        <section className="relative overflow-hidden rounded-[26px] border border-white/10 bg-[radial-gradient(130%_150%_at_100%_0%,#E8C96F_0%,#9B7028_25%,#46351F_51%,#17130D_79%,#0B0B09_100%)] p-5 shadow-[0_18px_42px_rgb(0_0_0/0.32)]">
          <span aria-hidden className="absolute -right-12 -top-12 h-36 w-36 rounded-full border border-white/10" />
          <p className="relative text-[11px] font-semibold uppercase tracking-[0.14em] text-white/58">Total balance</p>
          <p className="relative mt-3 text-[36px] font-semibold leading-none tracking-[-0.04em] tabular-nums">
            {balancesLoading ? "..." : `$${balance}`}
          </p>
          <p className="relative mt-2 text-[13px] text-[#F6D889]">{localBalance ?? "USDC balance"}</p>
          <div className="relative mt-6 flex items-center gap-2">
            <span className="rounded-lg border border-white/12 bg-black/20 px-2 py-1 text-[11px] font-medium text-white/75">USDC</span>
            <span className="text-[11px] text-white/48">BNB Smart Chain</span>
          </div>
        </section>

        <section className="mt-3 grid grid-cols-4 gap-2" aria-label="Main actions">
          {PRIMARY_ACTIONS.map(({ id, label, icon: Glyph }) => (
            <button
              key={id}
              type="button"
              onClick={() => onOpen(id)}
              className="group flex min-h-[86px] flex-col items-center justify-center gap-2 rounded-[18px] border border-white/[0.09] bg-white/[0.055] text-[11px] font-medium text-white/75 transition-[background-color,transform] hover:bg-white/[0.1] active:scale-[0.97]"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-[13px] bg-[#E8C96F] text-[#1B160E] transition-transform group-hover:-translate-y-0.5">
                <Glyph size={19} weight="bold" />
              </span>
              {label}
            </button>
          ))}
        </section>

        <section className="mt-5" aria-labelledby="services-title">
          <div className="mb-2 flex items-center justify-between px-1">
            <h1 id="services-title" className="text-[14px] font-semibold">Services</h1>
            <span className="text-[11px] text-white/40">Saku</span>
          </div>
          <div className="overflow-hidden rounded-[22px] border border-white/[0.09] bg-white/[0.045]">
            {SERVICES.map(({ id, label, detail, icon: Glyph }, index) => (
              <button
                key={id}
                type="button"
                onClick={() => onOpen(id)}
                className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.06] ${index > 0 ? "border-t border-white/[0.07]" : ""}`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.08] text-[#E8C96F]">
                  <Glyph size={19} weight="bold" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-white/90">{label}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-white/42">{detail}</span>
                </span>
                <CaretRight size={16} className="shrink-0 text-white/35" />
              </button>
            ))}
          </div>
        </section>

        <section className="mt-5" aria-labelledby="activity-title">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 id="activity-title" className="text-[14px] font-semibold">Recent activity</h2>
            <span className="text-[11px] text-white/40">Live</span>
          </div>
          <div className="overflow-hidden rounded-[22px] border border-white/[0.09] bg-white/[0.045]">
            {transactionsLoading && transactions.length === 0 ? (
              <div className="flex h-24 items-center justify-center text-white/35"><Loader2 className="h-4 w-4 animate-spin" /></div>
            ) : transactions.length === 0 ? (
              <p className="px-4 py-7 text-center text-[12px] text-white/42">Your completed transfers and deposits appear here.</p>
            ) : (
              transactions.map((transaction) => {
                const incoming = transaction.direction === "in"
                return (
                  <div key={transaction.txHash} className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3 last:border-b-0">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${incoming ? "bg-[#E8C96F]/15 text-[#F6D889]" : "bg-white/[0.08] text-white/65"}`}>
                      {incoming ? <ArrowDownLeft size={18} weight="bold" /> : <ArrowUpRight size={18} weight="bold" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-white/88">{transactionLabel(transaction)}</span>
                      <span className="mt-0.5 block text-[10px] text-white/40">{relativeDate(transaction.occurredAt)}</span>
                    </span>
                    <span className={`text-right text-[12px] font-semibold tabular-nums ${incoming ? "text-[#F6D889]" : "text-white/80"}`}>
                      {incoming ? "+" : "-"}{transactionAmount(transaction)}
                      <span className="ml-1 text-[10px] font-medium text-white/42">USDC</span>
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </section>

        <p className="px-1 pb-2 pt-5 text-center text-[10px] leading-relaxed text-white/30">
          Secured with your Saku OTP session. No seed phrase is stored in this extension.
        </p>
      </div>
    </main>
  )
}

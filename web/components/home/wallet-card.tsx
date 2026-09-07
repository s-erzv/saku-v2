"use client"

import { useState } from "react"
import { Copy, Check, ExternalLink, RefreshCw } from "lucide-react"
import { NETWORK_CONFIG, explorerAddressUrl } from "@/lib/config"
import { useTokenBalances } from "@/hooks/useTokenBalances"

/** Trim to a shape people can eyeball-match without reading 42 characters. */
function shorten(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** Two decimals is enough to read; the exact figure lives on-chain. */
function display(amount: string) {
  const value = Number(amount)
  if (!Number.isFinite(value)) return "0.00"
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

export default function WalletCard({ address }: { address: string }) {
  const { balances, nativeBalance, isLoading, error, refresh } = useTokenBalances(address)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  // Every on-chain action needs gas. A funded wallet with zero tBNB looks broken in a way that
  // is confusing unless it is called out here.
  const needsGas = Number(nativeBalance) === 0

  return (
    <section className="max-w-lg mx-auto px-5 sm:px-6">
      <div
        className="rounded-3xl p-5 text-white shadow-lg"
        style={{ background: "linear-gradient(135deg, #1f2937 0%, #0f172a 100%)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/50">
              {NETWORK_CONFIG.name}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <p className="font-mono text-sm text-white/90">{shorten(address)}</p>
              <button onClick={copy} aria-label="Copy address" className="text-white/50 hover:text-white transition-colors">
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <a
                href={explorerAddressUrl(address)}
                target="_blank"
                rel="noreferrer"
                aria-label="View on BscScan"
                className="text-white/50 hover:text-white transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
          <button onClick={refresh} aria-label="Refresh balances" className="text-white/50 hover:text-white transition-colors">
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {balances.map((token) => (
            <div key={token.address} className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-white/60">{token.symbol}</span>
              <span className="text-2xl font-bold tracking-tight tabular-nums">{display(token.formatted)}</span>
            </div>
          ))}
          {balances.length === 0 && !isLoading && (
            <p className="text-sm text-white/50">No token balances yet</p>
          )}
        </div>

        <div className="mt-5 pt-4 border-t border-white/10 flex items-center justify-between">
          <span className="text-xs font-medium text-white/50">Gas (tBNB)</span>
          <span className="text-xs font-semibold tabular-nums text-white/80">{display(nativeBalance)}</span>
        </div>
      </div>

      {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
      {needsGas && !error && (
        <p className="mt-2 text-xs font-medium text-amber-700">
          No tBNB for gas — grab some from the BNB Chain testnet faucet before sending.
        </p>
      )}
    </section>
  )
}

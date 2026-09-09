"use client"

/**
 * Receipt view for a single transaction row in History — opened on tap instead of jumping
 * straight to the block explorer. Share/Download render the same content onto a canvas (see
 * `lib/receipt-image.ts`) rather than reusing this JSX, since this app's gradients and
 * backdrop-blur don't survive DOM-to-image libraries. Both renderers read their rows from
 * `lib/receipt-content.ts`, which is what keeps them the same receipt.
 *
 * The paper is drawn as three stacked pieces — torn strip, body, torn strip — rather than one
 * masked box: a repeating triangle background tiles at a fixed tooth size regardless of the
 * card's width, where a `clip-path` or a stretched SVG would distort the teeth as it resizes.
 */

import { useState } from "react"
import { Check, Download, ExternalLink, Loader2, Share2, X } from "lucide-react"
import type { SakuTransaction } from "@/hooks/useTransactions"
import { explorerTxUrl } from "@/lib/config"
import { generateReceiptImage } from "@/lib/receipt-image"
import { buildReceipt, PAPER, TOOTH } from "@/lib/receipt-content"

/** One perforation tooth as a data URI, tiled along an edge. `paper` is the fill it cuts out of. */
function tornEdge(direction: "top" | "bottom", paper: string) {
  const { width: w, height: h } = TOOTH
  const path =
    direction === "top"
      ? `M0 ${h} L${w / 2} 0 L${w} ${h} Z`
      : `M0 0 L${w / 2} ${h} L${w} 0 Z`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${path}" fill="${paper}"/></svg>`
  return {
    height: h,
    backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
    backgroundRepeat: "repeat-x",
    backgroundSize: `${w}px ${h}px`,
  } as const
}

/** Faint fibre so the paper isn't a flat fill. Low enough that it reads as stock, not as noise. */
const PAPER_GRAIN =
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3"/></filter><rect width="120" height="120" filter="url(#n)" opacity="0.05"/></svg>`
  )}")`

function Divider() {
  return (
    <div
      className="h-px"
      style={{
        backgroundImage: `repeating-linear-gradient(90deg, ${PAPER.hairline} 0 5px, transparent 5px 10px)`,
      }}
    />
  )
}

export default function ReceiptModal({
  transaction,
  onClose,
}: {
  transaction: SakuTransaction
  onClose: () => void
}) {
  const [busy, setBusy] = useState<"share" | "download" | null>(null)
  const receipt = buildReceipt(transaction)
  const { incoming } = receipt

  async function handleShare() {
    setBusy("share")
    try {
      const blob = await generateReceiptImage(transaction)
      const file = new File([blob], `saku-receipt-${transaction.txHash.slice(0, 8)}.png`, { type: "image/png" })

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Saku receipt" })
      } else {
        await handleDownloadBlob(blob)
      }
    } catch (err) {
      // AbortError means the user just closed the native share sheet — not a failure.
      if (err instanceof Error && err.name !== "AbortError") {
        console.error("[receipt] share failed:", err)
      }
    } finally {
      setBusy(null)
    }
  }

  async function handleDownloadBlob(blob: Blob) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `saku-receipt-${transaction.txHash.slice(0, 8)}.png`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  async function handleDownload() {
    setBusy("download")
    try {
      const blob = await generateReceiptImage(transaction)
      await handleDownloadBlob(blob)
    } catch (err) {
      console.error("[receipt] download failed:", err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto bg-black/55 backdrop-blur-sm px-4 py-8">
      <div className="w-full max-w-[21rem] space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Receipt</p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 -mr-1.5 rounded-full text-white/70 hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* drop-shadow (not box-shadow) so the shadow follows the torn teeth instead of a rectangle */}
        <div style={{ filter: "drop-shadow(0 18px 34px rgba(0,0,0,0.35))" }}>
          <div style={tornEdge("top", PAPER.top)} />

          <div
            className="px-6 pt-5 pb-6"
            style={{
              backgroundImage: `${PAPER_GRAIN}, linear-gradient(${PAPER.top}, ${PAPER.bottom})`,
              color: PAPER.ink,
            }}
          >
            {/* Letterhead */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/saku-mark.png" alt="" width={28} height={28} className="w-7 h-7" />
                <span className="text-lg font-black tracking-tight leading-none">saku</span>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-black/35">
                Payment receipt
              </span>
            </div>

            <p
              className="mt-2 text-center text-[10px] uppercase tracking-[0.22em] text-black/35"
              style={{ fontFamily: "var(--font-receipt), ui-monospace, monospace" }}
            >
              {receipt.typeLabel}
            </p>

            <div className="mt-3">
              <Divider />
            </div>

            {/* Amount */}
            <div className="flex flex-col items-center gap-1.5 py-5">
              <p
                className="text-[40px] leading-none font-black tabular-nums"
                style={{ color: incoming ? PAPER.emerald : PAPER.ink }}
              >
                {incoming ? "+" : "−"}
                {receipt.amount}
              </p>
              <p
                className="text-[10px] font-bold uppercase tracking-[0.3em] text-black/35"
                style={{ fontFamily: "var(--font-receipt), ui-monospace, monospace" }}
              >
                USDC
              </p>
              <div
                className="mt-1 flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest"
                style={{ color: receipt.statusColor, backgroundColor: `${receipt.statusColor}1F` }}
              >
                {transaction.status === "confirmed" && <Check className="w-3 h-3" />}
                {receipt.statusLabel}
              </div>
            </div>

            <Divider />

            {/* Line items — dotted leaders, till-printer face */}
            <div
              className="py-4 space-y-2.5 text-[12px]"
              style={{ fontFamily: "var(--font-receipt), ui-monospace, monospace" }}
            >
              {receipt.rows.map((row) => (
                <div key={row.label} className="flex items-end gap-2">
                  <span className="shrink-0 uppercase tracking-wider text-black/40">{row.label}</span>
                  <span
                    className="flex-1 mb-[3px] h-px"
                    style={{
                      backgroundImage: `repeating-linear-gradient(90deg, ${PAPER.hairline} 0 2px, transparent 2px 5px)`,
                    }}
                  />
                  {row.label === "Ref" ? (
                    <a
                      href={explorerTxUrl(transaction.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 font-bold flex items-center gap-1 hover:underline"
                      style={{ color: PAPER.accent }}
                    >
                      {row.value}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <span className="shrink-0 font-bold max-w-[58%] truncate">{row.value}</span>
                  )}
                </div>
              ))}
            </div>

            <Divider />

            {/* The fee is added on top, so it is shown as its own line and the total is the sum.
                A fee folded into one number is a fee the payer cannot check. */}
            <div
              className="pt-3 pb-4 space-y-1.5"
              style={{ fontFamily: "var(--font-receipt), ui-monospace, monospace" }}
            >
              {receipt.fee && (
                <>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="uppercase tracking-wider text-black/40">Sent</span>
                    <span className="font-bold tabular-nums">{receipt.amount} USDC</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="uppercase tracking-wider text-black/40">Platform fee</span>
                    <span className="font-bold tabular-nums">+{receipt.fee} USDC</span>
                  </div>
                  <div className="h-px my-1" style={{ backgroundColor: PAPER.hairline }} />
                </>
              )}

              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-black/45">
                  {receipt.fee ? "Total paid" : "Total"}
                </span>
                <span className="text-sm font-bold tabular-nums">
                  {incoming ? "+" : "−"}
                  {receipt.total} USDC
                </span>
              </div>
            </div>

            {/* Printed barcode: derived from the tx hash, decorative — the Ref row is what verifies */}
            <div className="flex items-end justify-center gap-[2px] h-9" aria-hidden>
              {receipt.barcode.map((weight, i) => (
                <span
                  key={i}
                  className="block h-full"
                  style={{ width: weight, backgroundColor: i % 2 ? "transparent" : PAPER.ink }}
                />
              ))}
            </div>

            <p
              className="mt-2 text-center text-[9px] tracking-[0.15em] text-black/35"
              style={{ fontFamily: "var(--font-receipt), ui-monospace, monospace" }}
            >
              VERIFIED ON-CHAIN · TESTNET.BSCSCAN.COM
            </p>
            <p className="mt-1 text-center text-[10px] font-semibold text-black/30">
              Thank you for using Saku
            </p>
          </div>

          <div style={tornEdge("bottom", PAPER.bottom)} />
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleShare}
            disabled={busy !== null}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-white text-black text-sm font-bold disabled:opacity-50 transition-opacity"
          >
            {busy === "share" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
            Share
          </button>
          <button
            onClick={handleDownload}
            disabled={busy !== null}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-white/15 text-white text-sm font-bold disabled:opacity-50 transition-opacity"
          >
            {busy === "download" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

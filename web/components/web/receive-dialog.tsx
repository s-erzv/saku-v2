"use client"

/**
 * The wallet's address, as something to scan or copy.
 *
 * The address was already on the balance card, shortened, with a copy button. What a desktop
 * needs on top of that is the full string where it can be checked character by character, and a
 * code a phone can read off the screen — moving money in from another wallet is done by pointing
 * one device at another.
 *
 * It names the network before anything else. An address is the same on every EVM chain, so the
 * one mistake this dialog can prevent is someone sending on the wrong one.
 */

import { useEffect, useState } from "react"
import { ArrowSquareOut, Check, Copy, X } from "@phosphor-icons/react"
import { SakuQr } from "@/components/pay/saku-qr"
import { NETWORK_CONFIG, explorerAddressUrl } from "@/lib/config"

interface ReceiveDialogProps {
  address: string | null
  onClose: () => void
}

export default function ReceiveDialog({ address, onClose }: ReceiveDialogProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const copy = async () => {
    if (!address) return
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="receive-title" className="fixed inset-0 z-[70] flex items-center justify-center p-4 font-sans">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/45 animate-in fade-in duration-200"
      />

      <div className="relative w-full max-w-[380px] rounded-[28px] bg-white px-6 pb-6 pt-9 text-ink shadow-[0_30px_90px_rgb(20_18_14/0.28)] animate-in fade-in zoom-in-95 duration-200">
        <img
          src="/icons/saku-mark.png"
          alt=""
          className="absolute -top-6 left-6 h-12 w-12 rounded-full bg-white p-1.5 shadow-[0_6px_20px_rgb(20_18_14/0.14)] ring-1 ring-black/5"
        />
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-full p-2 text-black/45 transition-colors hover:bg-black/5 hover:text-black"
        >
          <X size={18} />
        </button>

        <h2 id="receive-title" className="pr-8 text-[22px] font-semibold leading-tight tracking-tight">
          Your Saku address
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-black/55">
          Send only on {NETWORK_CONFIG.name}. Anything sent on another network won&apos;t show up in Saku.
        </p>

        {address ? (
          <>
            <div className="mt-6 flex justify-center rounded-3xl border border-black/[0.07] p-5">
              <SakuQr value={address} size={184} />
            </div>

            <p className="mt-5 break-all font-mono text-[13px] leading-relaxed text-black/75">{address}</p>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                onClick={copy}
                className="flex items-center justify-center gap-2 rounded-2xl bg-black py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? "Copied" : "Copy address"}
              </button>
              <a
                href={explorerAddressUrl(address)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 rounded-2xl border border-black/10 py-3 text-sm font-medium transition-colors hover:border-black/25"
              >
                BscScan
                <ArrowSquareOut size={16} />
              </a>
            </div>
          </>
        ) : (
          <p className="mt-6 rounded-2xl bg-black/[0.03] px-4 py-3 text-sm text-black/55">
            Your wallet is still being set up. The address appears here as soon as it&apos;s ready.
          </p>
        )}
      </div>
    </div>
  )
}

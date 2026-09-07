"use client"

/**
 * QR pay — the screen behind the middle button in the nav.
 *
 * Two modes on one page, because in practice people arrive knowing which side they are on:
 * showing a code to be paid, or scanning someone else's.
 *
 * The camera is only started when the user picks Scan, and stopped on the way out. Holding a
 * camera stream open on a payments screen nobody is scanning with is not something to do
 * quietly.
 */

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Camera, Check, Copy, Loader2, QrCode, Wallet } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { useAuth } from "@/hooks/useAuth"
import { useMpcWallet } from "@/hooks/useMpcWallet"
import { useCreatePaymentRequest } from "@/hooks/useQrPayment"

type Mode = "request" | "scan"

const SCANNER_ELEMENT_ID = "saku-qr-scanner"

export default function PayPage() {
  const router = useRouter()
  const { user, isLoading, isAuthenticated } = useAuth()
  const { status } = useMpcWallet()
  const { creating, error, code, create, reset } = useCreatePaymentRequest()

  const [mode, setMode] = useState<Mode>("request")
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [copied, setCopied] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const scannerRef = useRef<{ stop: () => Promise<void> } | null>(null)

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/get-started")
  }, [isLoading, isAuthenticated, router])

  // Start the camera only while the Scan tab is open, and always tear it down on the way out.
  useEffect(() => {
    if (mode !== "scan") return

    let cancelled = false

    void (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode")
        if (cancelled) return

        const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID)
        scannerRef.current = scanner

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded) => {
            // A real merchant QRIS starts with the EMVCo payload format indicator. It is far
            // longer than a Saku code, so it is checked first.
            if (decoded.trim().startsWith("000201")) {
              void scanner.stop().catch(() => {})
              // Passed via sessionStorage rather than the URL: a QRIS payload is ~150-300 chars
              // and does not belong in a browser history entry.
              try {
                sessionStorage.setItem("saku_qris_payload", decoded.trim())
                router.push("/pay/qris")
              } catch {
                setScanError("Could not read that code on this device.")
              }
              return
            }

            // Otherwise: a Saku request, as a full link or a bare code.
            const match = decoded.match(/\/pay\/([A-Z0-9]{6,16})/i) ?? decoded.match(/^([A-Z0-9]{6,16})$/i)
            if (match) {
              void scanner.stop().catch(() => {})
              router.push(`/pay/${match[1].toUpperCase()}`)
            }
          },
          () => {
            // Per-frame decode misses are normal; only surface real failures.
          }
        )
      } catch {
        if (!cancelled) setScanError("Could not open the camera. Check permissions, or enter the code manually.")
      }
    })()

    return () => {
      cancelled = true
      void scannerRef.current?.stop().catch(() => {})
      scannerRef.current = null
    }
  }, [mode, router])

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-black/20" />
      </div>
    )
  }

  if (!user) return null

  const link = typeof window !== "undefined" && code ? `${window.location.origin}/pay/${code}` : ""

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
          <h1 className="text-xl font-black tracking-tight">QR Pay</h1>
        </div>

        {status !== "connected" ? (
          <div className="p-5 rounded-3xl bg-amber-50 border border-amber-200 flex items-start gap-3">
            <Wallet className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-bold text-amber-900">Wallet not ready</p>
              <p className="text-xs text-amber-800">Finish setting up your wallet from Home first.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex p-1 bg-black/[0.04] rounded-2xl">
              {(["request", "scan"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); if (m === "request") setScanError(null) }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all ${
                    mode === m ? "bg-white shadow-sm" : "text-black/45"
                  }`}
                >
                  {m === "request" ? <QrCode className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
                  {m === "request" ? "Receive" : "Scan"}
                </button>
              ))}
            </div>

            {mode === "request" ? (
              code ? (
                <div className="space-y-5 text-center animate-in zoom-in-95 duration-300">
                  <div className="inline-flex p-5 bg-white rounded-3xl border border-black/8 shadow-sm">
                    <QRCodeSVG value={link} size={200} level="M" />
                  </div>

                  <div className="space-y-1">
                    <p className="text-2xl font-black tracking-[0.2em] font-mono">{code}</p>
                    <p className="text-sm text-black/45">
                      {amount ? `${amount} USDC` : "Any amount"}
                      {note && ` · ${note}`}
                    </p>
                  </div>

                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(link)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1800)
                    }}
                    className="w-full py-3.5 rounded-2xl border-2 border-black/10 font-bold text-sm flex items-center justify-center gap-2 hover:border-black/25 transition-colors"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? "Link copied" : "Copy link"}
                  </button>

                  <button
                    onClick={() => { reset(); setAmount(""); setNote("") }}
                    className="w-full py-3 text-sm font-semibold text-black/45"
                  >
                    New request
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-3xl border border-black/8 bg-[#FAFAFA] px-5 py-6 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-black/35">
                      Amount (optional)
                    </p>
                    <div className="mt-3 flex items-center justify-center gap-2">
                      <input
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                        placeholder="0"
                        className="w-full max-w-[180px] bg-transparent outline-none text-center text-5xl font-black tabular-nums placeholder:text-black/15"
                      />
                      <span className="text-xl font-bold text-black/35">USDC</span>
                    </div>
                    <p className="mt-3 text-[11px] text-black/40">
                      Leave empty to let the payer choose.
                    </p>
                  </div>

                  <input
                    value={note}
                    maxLength={140}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="What's it for? (optional)"
                    className="w-full px-4 py-3 bg-[#FAFAFA] border-2 border-transparent rounded-2xl text-sm font-semibold focus:border-black outline-none transition-all"
                  />

                  {error && <p className="text-sm font-medium text-red-600">{error}</p>}

                  <button
                    onClick={() => create(amount, note)}
                    disabled={creating}
                    className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-lg disabled:opacity-40 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                  >
                    {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                    {creating ? "Creating…" : "Show QR"}
                  </button>
                </div>
              )
            ) : (
              <div className="space-y-4">
                <div
                  id={SCANNER_ELEMENT_ID}
                  className="w-full aspect-square rounded-3xl overflow-hidden bg-black/[0.04] border border-black/8"
                />
                {scanError ? (
                  <p className="text-sm font-medium text-red-600 text-center">{scanError}</p>
                ) : (
                  <p className="text-xs text-black/40 text-center">
                    Point the camera at a Saku code or a merchant QRIS.
                  </p>
                )}

                <div className="pt-2 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-black/35 text-center">
                    Or enter a code
                  </p>
                  <input
                    onChange={(e) => {
                      const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")
                      if (value.length >= 6) router.push(`/pay/${value}`)
                    }}
                    placeholder="ABCD1234"
                    className="w-full px-4 py-3 bg-[#FAFAFA] border-2 border-transparent rounded-2xl text-center text-lg font-black tracking-[0.2em] font-mono focus:border-black outline-none transition-all"
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

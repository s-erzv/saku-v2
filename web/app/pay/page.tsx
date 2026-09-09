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

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import type { Html5Qrcode } from "html5-qrcode"
import { ArrowLeft, ArrowLeftRight, Camera, Check, Copy, Download, ImageUp, Loader2, QrCode, Wallet } from "lucide-react"
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react"
import { useAuth } from "@/hooks/useAuth"
import { useMpcWallet } from "@/hooks/useMpcWallet"
import { useCreatePaymentRequest } from "@/hooks/useQrPayment"
import { useCurrencyToggleAmount } from "@/hooks/useCurrencyToggleAmount"
import { formatLocal } from "@/hooks/useLocalCurrency"
import { generateQrImage } from "@/lib/qr-image"

type Mode = "request" | "scan"

const SCANNER_ELEMENT_ID = "saku-qr-scanner"

export default function PayPage() {
  const router = useRouter()
  const { user, isLoading, isAuthenticated } = useAuth()
  const { status } = useMpcWallet()
  const { creating, error, code, create, reset } = useCreatePaymentRequest()

  // The amount can be typed in USDC or in the currency of the number the user signed up with,
  // same as every other amount field in the app. What is requested is still USDC.
  const money = useCurrencyToggleAmount(isAuthenticated)
  const amount = money.amountUsdc

  const [mode, setMode] = useState<Mode>("request")
  const [note, setNote] = useState("")
  const [copied, setCopied] = useState(false)
  const [savingQr, setSavingQr] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanBusy, setScanBusy] = useState(false)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const qrCanvasRef = useRef<HTMLDivElement | null>(null)
  const uploadRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/get-started")
  }, [isLoading, isAuthenticated, router])

  /**
   * Stop the camera, if it is actually running.
   *
   * html5-qrcode throws — synchronously, so a trailing `.catch()` never sees it — when `stop()`
   * is called on a scanner that was never started or has already stopped. Both happen here
   * routinely: the decode callback stops the camera, and then the effect cleanup stops it again
   * on the way out. That is the "Cannot stop, scanner is not running or paused" error.
   */
  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current
    if (!scanner) return
    try {
      // 2 = SCANNING, 3 = PAUSED. Anything else has nothing to stop.
      const state = scanner.getState()
      if (state === 2 || state === 3) await scanner.stop()
    } catch {
      // Already stopped, or never started. Either way there is nothing to do.
    }
  }, [])

  /** One place that decides where a decoded string goes, whether it came from the camera or a file. */
  const handleDecoded = useCallback(
    (raw: string) => {
      const decoded = raw.trim()

      // A real merchant QRIS starts with the EMVCo payload format indicator. It is far longer
      // than a Saku code, so it is checked first.
      if (decoded.startsWith("000201")) {
        // Passed via sessionStorage rather than the URL: a QRIS payload is ~150-300 chars and
        // does not belong in a browser history entry.
        try {
          sessionStorage.setItem("saku_qris_payload", decoded)
          router.push("/pay/qris")
        } catch {
          setScanError("Could not read that code on this device.")
        }
        return true
      }

      // Otherwise: a Saku request, as a full link or a bare code.
      const match = decoded.match(/\/pay\/([A-Z0-9]{6,16})/i) ?? decoded.match(/^([A-Z0-9]{6,16})$/i)
      if (match) {
        router.push(`/pay/${match[1].toUpperCase()}`)
        return true
      }

      return false
    },
    [router]
  )

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
            if (handleDecoded(decoded)) void stopScanner()
          },
          () => {
            // Per-frame decode misses are normal; only surface real failures.
          }
        )
      } catch {
        // A camera that will not open is not a dead end — the upload and manual-code paths below
        // both still work, so this reads as a note rather than an error.
        if (!cancelled) setScanError("Camera unavailable. Upload a photo of the code, or type it in.")
      }
    })()

    return () => {
      cancelled = true
      void stopScanner()
      scannerRef.current = null
    }
  }, [mode, handleDecoded, stopScanner])

  /**
   * Read a QR out of a saved image — a screenshot of a bill, a code someone sent in a chat.
   * The camera has to be released first: html5-qrcode will not scan a file while it is running.
   */
  const scanImage = useCallback(
    async (file: File) => {
      setScanBusy(true)
      setScanError(null)
      try {
        await stopScanner()

        let scanner = scannerRef.current
        if (!scanner) {
          const { Html5Qrcode } = await import("html5-qrcode")
          scanner = new Html5Qrcode(SCANNER_ELEMENT_ID)
          scannerRef.current = scanner
        }

        const decoded = await scanner.scanFile(file, false)
        if (!handleDecoded(decoded)) {
          setScanError("That code isn't a Saku request or a QRIS.")
        }
      } catch {
        setScanError("No QR code found in that image. Try a clearer, closer photo.")
      } finally {
        setScanBusy(false)
      }
    },
    [handleDecoded, stopScanner]
  )

  /**
   * Save the request as an image — the code plus what it is for, not a bare QR square. Shares
   * through the native sheet where that exists, and falls back to a download everywhere else.
   */
  const saveQr = useCallback(async () => {
    const qrCanvas = qrCanvasRef.current?.querySelector("canvas")
    if (!qrCanvas || !code) return

    setSavingQr(true)
    try {
      const blob = await generateQrImage({
        qrCanvas,
        code,
        amount: amount || null,
        localAmount: amount && money.currency ? formatLocal(Number(amount), money.currency) : null,
        note: note.trim() || null,
        payeeName: user?.display_name ?? null,
      })

      const file = new File([blob], `saku-qr-${code}.png`, { type: "image/png" })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Saku payment request" })
      } else {
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = file.name
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      // AbortError just means the share sheet was dismissed.
      if (err instanceof Error && err.name !== "AbortError") console.error("[qr] save failed:", err)
    } finally {
      setSavingQr(false)
    }
  }, [amount, code, money.currency, note, user?.display_name])

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

                  {/* The same payload at print resolution, offscreen. Downloading composites this
                      rather than re-encoding, so the saved image is the code that was on screen. */}
                  <div ref={qrCanvasRef} className="hidden" aria-hidden>
                    <QRCodeCanvas value={link} size={760} level="M" marginSize={2} />
                  </div>

                  <div className="space-y-1">
                    <p className="text-2xl font-black tracking-[0.2em] font-mono">{code}</p>
                    <p className="text-sm text-black/45">
                      {amount ? `${amount} USDC` : "Any amount"}
                      {note && ` · ${note}`}
                    </p>
                    {amount && money.currency && (
                      <p className="text-xs font-semibold text-black/35">
                        ≈ {formatLocal(Number(amount), money.currency)}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(link)
                        setCopied(true)
                        setTimeout(() => setCopied(false), 1800)
                      }}
                      className="flex-1 py-3.5 rounded-2xl border-2 border-black/10 font-bold text-sm flex items-center justify-center gap-2 hover:border-black/25 transition-colors"
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copied ? "Copied" : "Copy link"}
                    </button>

                    <button
                      onClick={saveQr}
                      disabled={savingQr}
                      className="flex-1 py-3.5 rounded-2xl bg-black text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-opacity"
                    >
                      {savingQr ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      Save QR
                    </button>
                  </div>

                  <button
                    onClick={() => { reset(); money.reset(); setNote("") }}
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
                        value={money.displayValue}
                        onChange={(e) => money.setDisplayValue(e.target.value)}
                        placeholder="0"
                        className="w-full max-w-[190px] bg-transparent outline-none text-center text-5xl font-black tabular-nums placeholder:text-black/15"
                      />
                      <span className="text-xl font-bold text-black/35">{money.unitLabel}</span>
                    </div>

                    {money.currency && (
                      <div className="mt-3 flex items-center justify-center gap-2">
                        <p className="text-xs font-semibold text-black/40 tabular-nums">
                          {money.unit === "usdc"
                            ? (formatLocal(Number(amount || 0), money.currency) ?? "")
                            : `${Number(amount || 0).toFixed(2)} USDC`}
                        </p>
                        <button
                          type="button"
                          onClick={money.toggleUnit}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/[0.06] text-[10px] font-bold uppercase tracking-widest text-black/55 hover:bg-black/10 transition-colors"
                        >
                          <ArrowLeftRight className="w-3 h-3" />
                          {money.unit === "usdc" ? money.currency.code : "USDC"}
                        </button>
                      </div>
                    )}

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
                {/* Styled as a note, not an alarm: every message here has a working way forward
                    directly beneath it — upload an image, or type the code. */}
                {scanError ? (
                  <p className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-center">
                    {scanError}
                  </p>
                ) : null}

                {/* Not every code arrives in front of a camera — a bill photographed earlier, or
                    a QR someone sent in a chat, is the same code in a file. */}
                <input
                  ref={uploadRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void scanImage(file)
                    e.target.value = ""
                  }}
                />
                <button
                  onClick={() => uploadRef.current?.click()}
                  disabled={scanBusy}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-black/12 text-sm font-bold text-black/55 hover:border-black/25 transition-colors disabled:opacity-50"
                >
                  {scanBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageUp className="w-4 h-4" />}
                  {scanBusy ? "Reading…" : "Upload a QR image"}
                </button>

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

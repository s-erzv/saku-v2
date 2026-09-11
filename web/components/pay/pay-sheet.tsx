"use client"

/**
 * Pay, as a sheet over whatever screen you were on.
 *
 * It used to be `/pay`, a route of its own — which meant tapping the middle button threw away
 * the bottom bar, the screen underneath, and the sense that you were still inside the app for
 * the sake of showing a code. Every wallet people already use does this as a panel that slides
 * up and can be flicked away, and so does this: the nav bar stays where it is, the screen behind
 * stays where it is, and closing costs a swipe rather than a back button.
 *
 * Three panes side by side, moved between by swiping across or tapping the chips at the top.
 * They are the three things someone opens this for, and they are siblings because they are
 * genuinely different transactions rather than settings of one:
 *
 *  - **Scan** — the camera, an upload for a code that arrived as a picture, and a field for
 *    typing a code in. The camera runs only while this pane is the visible one *and* the sheet
 *    is open, and is torn down on the way out of either. A camera left streaming on a payments
 *    screen nobody is scanning with is not something to do quietly.
 *  - **My code** — a code of your own with no amount on it, minted as soon as the pane opens so
 *    the common case costs no taps at all. Hand the phone over; the payer types what they owe.
 *  - **Bill** — a code with the figure fixed before it is shown. The payer confirms the amount
 *    rather than entering one, which is what a price is.
 *
 * Both kinds already existed on the server: `/api/qr-payment/create` has always taken an
 * optional amount, and the claim screen has always asked the payer for a number when the request
 * carried none. Only the open one had no way to ask for it.
 *
 * The two panes hold *separate* requests rather than sharing one. Swiping from a bill back to
 * your own code should not find the bill there, and minting the open code should not quietly
 * discard a bill someone is part-way through writing.
 *
 * The horizontal movement is a scroll-snap container rather than a drag handler. It is one line
 * of CSS, it inherits momentum, edge resistance and accessibility from the platform, and it does
 * not fight the vertical drag the way two custom gesture handlers on one element would. The
 * vertical drag is bound to the grab handle alone for the same reason: a drag that started
 * anywhere would have to guess, on every pointer move, whether a diagonal swipe meant "next
 * pane" or "dismiss", and guessing wrong on a payments screen closes something mid-transaction.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import type { Html5Qrcode } from "html5-qrcode"
import {
  ArrowLeftRight,
  Camera,
  Check,
  Copy,
  Download,
  ImageUp,
  Loader2,
  QrCode,
  ReceiptText,
  Wallet,
} from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useMpcWallet } from "@/hooks/useMpcWallet"
import { useCreatePaymentRequest } from "@/hooks/useQrPayment"
import { useCurrencyToggleAmount } from "@/hooks/useCurrencyToggleAmount"
import { formatLocal, type LocalCurrencyInfo } from "@/hooks/useLocalCurrency"
import { generateQrImage } from "@/lib/qr-image"
import { SakuQr, SakuQrCanvas } from "@/components/pay/saku-qr"

const SCANNER_ELEMENT_ID = "saku-qr-scanner"

/** Past this much downward travel, releasing closes rather than springs back. */
const DISMISS_AFTER_PX = 120

type Pane = 0 | 1 | 2

const TABS = [
  { id: 0 as Pane, label: "Scan", icon: Camera },
  { id: 1 as Pane, label: "My code", icon: QrCode },
  { id: 2 as Pane, label: "Bill", icon: ReceiptText },
]

interface PaySheetProps {
  open: boolean
  onClose: () => void
}

/**
 * Mounting is the reset.
 *
 * Everything in this sheet is per-opening — the minted codes, a half-typed amount, a scanner
 * error, which pane you were on. Keeping the body mounted and clearing that on close would mean
 * an effect writing a pile of state on every dismissal, and any field added later that someone
 * forgets to add to it becomes the next person's leftovers appearing in front of them.
 * Unmounting cannot forget.
 */
export default function PaySheet({ open, onClose }: PaySheetProps) {
  if (!open) return null
  return <PaySheetBody onClose={onClose} />
}

function PaySheetBody({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const { user, isAuthenticated } = useAuth()
  const { status } = useMpcWallet()

  // Two independent requests. See the note at the top on why they are not one.
  const openReq = useCreatePaymentRequest()
  const billReq = useCreatePaymentRequest()
  const createOpen = openReq.create

  // The amount belongs to the bill pane alone; the open code has none by definition.
  const money = useCurrencyToggleAmount(isAuthenticated)
  const amount = money.amountUsdc
  const currency = money.currency

  const [pane, setPane] = useState<Pane>(0)
  /**
   * Where the rail actually is, as a fraction of a pane — 0, 1.37, 2 — rather than which pane
   * won a rounding. The pill above is positioned straight off it, so it travels with the finger
   * instead of jumping when the swipe passes half way. That continuity is the whole difference
   * between a tab bar and something that feels attached to the content.
   */
  const [progress, setProgress] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [note, setNote] = useState("")
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanBusy, setScanBusy] = useState(false)

  const scannerRef = useRef<Html5Qrcode | null>(null)
  const uploadRef = useRef<HTMLInputElement | null>(null)
  const railRef = useRef<HTMLDivElement | null>(null)
  const dragStart = useRef(0)
  /** Guards the open-amount mint: two scroll events land before any state has updated. */
  const mintedOpen = useRef(false)

  const walletReady = status === "connected"
  const payeeName = user?.display_name ?? null

  /* ---------------------------------------------------------------- scanning */

  /**
   * html5-qrcode throws — synchronously, so a trailing `.catch()` never sees it — when `stop()`
   * is called on a scanner that was never started or has already stopped. Both happen here
   * routinely: the decode callback stops the camera and then the effect cleanup stops it again.
   */
  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current
    if (!scanner) return
    try {
      const state = scanner.getState()
      // 2 = SCANNING, 3 = PAUSED. Anything else has nothing to stop.
      if (state === 2 || state === 3) await scanner.stop()
    } catch {
      // Already stopped, or never started.
    }
  }, [])

  /** One place that decides where a decoded string goes, camera or file. */
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
          onClose()
          router.push("/pay/qris")
        } catch {
          setScanError("Could not read that code on this device.")
        }
        return true
      }

      const match = decoded.match(/\/pay\/([A-Z0-9]{6,16})/i) ?? decoded.match(/^([A-Z0-9]{6,16})$/i)
      if (match) {
        onClose()
        router.push(`/pay/${match[1].toUpperCase()}`)
        return true
      }

      return false
    },
    [onClose, router]
  )

  useEffect(() => {
    if (pane !== 0 || !walletReady) return

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
  }, [pane, walletReady, handleDecoded, stopScanner])

  /**
   * Read a QR out of a saved image — a screenshot of a bill, a code sent in a chat. The camera
   * has to be released first: html5-qrcode will not scan a file while it is running.
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
        if (!handleDecoded(decoded)) setScanError("That code isn't a Saku request or a QRIS.")
      } catch {
        setScanError("No QR code found in that image. Try a clearer, closer photo.")
      } finally {
        setScanBusy(false)
      }
    },
    [handleDecoded, stopScanner]
  )

  /* -------------------------------------------------------------- my code */

  /**
   * Mint the open-amount code. It arrives without being asked for, because making the common
   * path cost a tap is how the common path becomes the slow one.
   *
   * Called from whatever *moved* onto the pane — a chip, a swipe — rather than from an effect
   * watching `pane`. An effect would be starting a network write as a side effect of a render,
   * and `create` sets state on its first line, so it would also be a render scheduling another.
   * The interaction is the cause; it should be the caller.
   */
  const ensureOpenCode = useCallback(() => {
    if (!walletReady || mintedOpen.current) return
    mintedOpen.current = true
    void createOpen()
  }, [walletReady, createOpen])

  /* ----------------------------------------------------------------- drag */

  const onHandleDown = (e: React.PointerEvent) => {
    dragStart.current = e.clientY
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onHandleMove = (e: React.PointerEvent) => {
    if (!dragging) return
    setDragY(e.clientY - dragStart.current)
  }

  const onHandleUp = () => {
    if (!dragging) return
    setDragging(false)
    if (dragY > DISMISS_AFTER_PX) onClose()
    // A decisive flick upwards is the gesture for "give me the whole screen".
    else if (dragY < -40) setExpanded(true)
    else if (dragY > 40) setExpanded(false)
    setDragY(0)
  }

  const goToPane = (next: Pane) => {
    setPane(next)
    if (next === 1) ensureOpenCode()
    // The smooth scroll fires the rail's own scroll handler all the way there, which is what
    // drives `progress` — so a tap slides the pill exactly as a swipe does rather than
    // teleporting it and then letting the content catch up.
    const rail = railRef.current
    if (rail) rail.scrollTo({ left: next * rail.clientWidth, behavior: "smooth" })
  }

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Pay">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 animate-in fade-in duration-200"
      />

      <div
        className="absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_-8px_40px_rgba(0,0,0,0.18)] animate-in slide-in-from-bottom duration-300"
        style={{
          height: expanded ? "100dvh" : "88dvh",
          transform: `translateY(${Math.max(dragY, 0)}px)`,
          transition: dragging ? "none" : "transform 220ms ease-out, height 220ms ease-out",
        }}
      >
        {/* The only surface the vertical drag listens on. */}
        <div
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          className="shrink-0 cursor-grab touch-none px-5 pb-1 pt-3 active:cursor-grabbing"
        >
          <span className="mx-auto block h-1.5 w-10 rounded-full bg-black/15" />
        </div>

        {/* Three equal columns, deliberately. Pills sized to their own labels would mean
            measuring each one and interpolating between the measurements to slide between them —
            a resize observer and a layout effect to move a pill. Equal thirds put the pill's
            position in one line of arithmetic that is correct at every width. */}
        <div className="shrink-0 px-5 pb-3 pt-2">
          <div role="tablist" className="relative grid grid-cols-3 rounded-full bg-black/[0.05] p-1">
            <span
              aria-hidden
              className="absolute inset-y-1 rounded-full bg-black"
              style={{
                width: "calc((100% - 0.5rem) / 3)",
                left: `calc(0.25rem + ${progress} * (100% - 0.5rem) / 3)`,
              }}
            />
            {TABS.map((tab) => {
              const Icon = tab.icon
              // Flips at the half-way point, which is where the pill has just covered more of
              // this chip than the last one.
              const lit = Math.round(progress) === tab.id
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={pane === tab.id}
                  onClick={() => goToPane(tab.id)}
                  className={`relative z-10 flex items-center justify-center gap-1.5 rounded-full py-2 text-sm font-bold transition-colors duration-150 ${
                    lit ? "text-white" : "text-black/50"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        {!walletReady ? (
          <div className="px-5 pb-8">
            <div className="flex items-start gap-3 rounded-3xl border border-amber-200 bg-amber-50 p-5">
              <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-amber-900">Wallet not ready</p>
                <p className="text-xs text-amber-800">Finish setting up your wallet from Home first.</p>
              </div>
            </div>
          </div>
        ) : (
          <div
            ref={railRef}
            onScroll={(e) => {
              const el = e.currentTarget
              if (!el.clientWidth) return
              const exact = Math.min(Math.max(el.scrollLeft / el.clientWidth, 0), TABS.length - 1)
              setProgress(exact)

              const next = Math.round(exact) as Pane
              if (next === pane) return
              setPane(next)
              if (next === 1) ensureOpenCode()
            }}
            className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {/* ---------------------------------------------------------- scan */}
            <section className="w-full shrink-0 snap-center overflow-y-auto px-5 pb-10">
              <div
                id={SCANNER_ELEMENT_ID}
                className="aspect-square w-full overflow-hidden rounded-3xl border border-black/8 bg-black/[0.04]"
              />

              {/* A note, not an alarm: every message here has a working way forward beneath it. */}
              {scanError && (
                <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-xs font-medium text-amber-800">
                  {scanError}
                </p>
              )}

              {/* Not every code arrives in front of a camera — a bill photographed earlier, or a
                  QR someone sent in a chat, is the same code in a file. */}
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
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-black/12 py-3 text-sm font-bold text-black/55 transition-colors hover:border-black/25 disabled:opacity-50"
              >
                {scanBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" />}
                {scanBusy ? "Reading…" : "Upload a QR image"}
              </button>

              <div className="mt-5 space-y-2">
                <p className="text-center text-[10px] font-bold uppercase tracking-widest text-black/35">
                  Or enter a code
                </p>
                <input
                  onChange={(e) => {
                    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")
                    if (value.length >= 6) {
                      onClose()
                      router.push(`/pay/${value}`)
                    }
                  }}
                  placeholder="ABCD1234"
                  className="w-full rounded-2xl border-2 border-transparent bg-[#FAFAFA] px-4 py-3 text-center font-mono text-lg font-black tracking-[0.2em] outline-none transition-all focus:border-black"
                />
              </div>
            </section>

            {/* ------------------------------------------------------- my code */}
            <section className="w-full shrink-0 snap-center overflow-y-auto px-5 pb-10">
              {openReq.code ? (
                <CodeView
                  code={openReq.code}
                  amount={null}
                  note={null}
                  currency={currency}
                  payeeName={payeeName}
                  caption="They enter the amount"
                />
              ) : openReq.error ? (
                <p className="py-10 text-center text-sm font-medium text-red-600">{openReq.error}</p>
              ) : (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-black/20" />
                </div>
              )}
            </section>

            {/* ---------------------------------------------------------- bill */}
            <section className="w-full shrink-0 snap-center overflow-y-auto px-5 pb-10">
              {billReq.code ? (
                <div className="space-y-4">
                  <CodeView
                    code={billReq.code}
                    amount={amount || null}
                    note={note.trim() || null}
                    currency={currency}
                    payeeName={payeeName}
                    caption={`${amount} USDC · fixed`}
                  />
                  <button
                    onClick={() => {
                      billReq.reset()
                      money.reset()
                      setNote("")
                    }}
                    className="w-full py-2 text-sm font-semibold text-black/45"
                  >
                    New bill
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-3xl border border-black/8 bg-[#FAFAFA] px-5 py-6 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-black/35">
                      They pay exactly
                    </p>
                    <div className="mt-3 flex items-center justify-center gap-2">
                      <input
                        inputMode="decimal"
                        value={money.displayValue}
                        onChange={(e) => money.setDisplayValue(e.target.value)}
                        placeholder="0"
                        className="w-full max-w-[190px] bg-transparent text-center text-5xl font-black tabular-nums outline-none placeholder:text-black/15"
                      />
                      <span className="text-xl font-bold text-black/35">{money.unitLabel}</span>
                    </div>

                    {currency && (
                      <div className="mt-3 flex items-center justify-center gap-2">
                        <p className="text-xs font-semibold tabular-nums text-black/40">
                          {money.unit === "usdc"
                            ? (formatLocal(Number(amount || 0), currency) ?? "")
                            : `${Number(amount || 0).toFixed(2)} USDC`}
                        </p>
                        <button
                          type="button"
                          onClick={money.toggleUnit}
                          className="flex items-center gap-1 rounded-full bg-black/[0.06] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-black/55 transition-colors hover:bg-black/10"
                        >
                          <ArrowLeftRight className="h-3 w-3" />
                          {money.unit === "usdc" ? currency.code : "USDC"}
                        </button>
                      </div>
                    )}
                  </div>

                  <input
                    value={note}
                    maxLength={140}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="What's it for? (optional)"
                    className="w-full rounded-2xl border-2 border-transparent bg-[#FAFAFA] px-4 py-3 text-sm font-semibold outline-none transition-all focus:border-black"
                  />

                  {billReq.error && (
                    <p className="text-sm font-medium text-red-600">{billReq.error}</p>
                  )}

                  <button
                    onClick={() => billReq.create(amount, note)}
                    disabled={billReq.creating || !amount}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-black py-4 font-bold text-white shadow-lg transition-all active:scale-[0.98] disabled:opacity-40"
                  >
                    {billReq.creating && <Loader2 className="h-4 w-4 animate-spin" />}
                    {billReq.creating ? "Creating…" : "Show the bill"}
                  </button>

                  <p className="text-center text-[11px] leading-snug text-black/40">
                    The amount is fixed on the code. Whoever scans it confirms the figure rather
                    than typing one.
                  </p>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * A minted code, shown. Shared by both code panes so the QR, the short code, and the copy and
 * save controls cannot drift apart between "my code" and "a bill" — the two differ by what is
 * written on the request, not by how a request looks.
 */
function CodeView({
  code,
  amount,
  note,
  currency,
  payeeName,
  caption,
}: {
  code: string
  amount: string | null
  note: string | null
  currency: LocalCurrencyInfo | null
  payeeName: string | null
  caption: string
}) {
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const canvasRef = useRef<HTMLDivElement | null>(null)

  const link = typeof window !== "undefined" ? `${window.location.origin}/pay/${code}` : ""

  /**
   * Save the request as an image — the code plus what it is for, not a bare QR square. Shares
   * through the native sheet where that exists, and falls back to a download everywhere else.
   *
   * A plain function, not a `useCallback`: it is called from an onClick and never from an effect
   * or a memo, so wrapping it buys no stability.
   */
  const save = async () => {
    const qrCanvas = canvasRef.current?.querySelector("canvas")
    if (!qrCanvas) return

    setSaving(true)
    try {
      const blob = await generateQrImage({
        qrCanvas,
        code,
        amount,
        localAmount: amount && currency ? formatLocal(Number(amount), currency) : null,
        note,
        payeeName,
      })

      const file = new File([blob], `saku-qr-${code}.png`, { type: "image/png" })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Saku payment request" })
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = file.name
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      // AbortError just means the share sheet was dismissed.
      if (err instanceof Error && err.name !== "AbortError") console.error("[qr] save failed:", err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 text-center">
      <div className="inline-flex rounded-3xl border border-black/8 bg-white p-5 shadow-sm">
        <SakuQr value={link} size={216} />
      </div>

      {/* The same payload at print resolution, offscreen. Saving composites this rather than
          re-encoding, so the saved image is the code that was on screen. */}
      <div ref={canvasRef} className="hidden" aria-hidden>
        <SakuQrCanvas value={link} />
      </div>

      <div className="space-y-1">
        <p className="font-mono text-2xl font-black tracking-[0.2em]">{code}</p>
        <p className="text-sm text-black/45">
          {caption}
          {note && ` · ${note}`}
        </p>
        {amount && currency && (
          <p className="text-xs font-semibold text-black/35">
            ≈ {formatLocal(Number(amount), currency)}
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
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-black/10 py-3.5 text-sm font-bold transition-colors hover:border-black/25"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy link"}
        </button>

        <button
          onClick={save}
          disabled={saving}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-black py-3.5 text-sm font-bold text-white transition-opacity disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Save QR
        </button>
      </div>
    </div>
  )
}

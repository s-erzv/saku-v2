"use client"

/**
 * A Saku QR: the code with the logo punched into the middle of it.
 *
 * The logo is not decoration — a payment code with nothing on it is a grey square that could
 * have come from anywhere, and the one thing a person needs to know before pointing a camera at
 * it is whose code it is.
 *
 * Error correction goes to H for exactly that reason. A QR at level M recovers about 15% of a
 * damaged payload; the logo covers a fifth of the code's area, so at M a scanner is being asked
 * to recover more than the format can promise and the code becomes unreliable in poor light or
 * at an angle. H recovers 30%, which is what buys the space the logo sits in. `excavate` clears
 * the modules underneath rather than painting over live data.
 *
 * The canvas variant is not a second copy of the code — it is the same payload at print
 * resolution, kept offscreen, so saving an image composites what was on screen rather than
 * re-encoding it. The logo is same-origin, so the canvas stays untainted and `toBlob` still
 * works; a logo served from another host would silently break saving.
 */

import { QRCodeCanvas, QRCodeSVG } from "qrcode.react"

const LOGO_SRC = "/logo.png"

/** A fifth of the code's width, which is what level H's 30% recovery comfortably covers. */
const LOGO_RATIO = 0.2

interface SakuQrProps {
  value: string
  size?: number
  className?: string
}

export function SakuQr({ value, size = 220, className = "" }: SakuQrProps) {
  const logo = Math.round(size * LOGO_RATIO)
  return (
    <QRCodeSVG
      value={value}
      size={size}
      level="H"
      className={className}
      imageSettings={{ src: LOGO_SRC, height: logo, width: logo, excavate: true }}
    />
  )
}

/** The print-resolution twin, for the save-as-image path. Render it hidden. */
export function SakuQrCanvas({ value, size = 760 }: { value: string; size?: number }) {
  const logo = Math.round(size * LOGO_RATIO)
  return (
    <QRCodeCanvas
      value={value}
      size={size}
      level="H"
      marginSize={2}
      imageSettings={{ src: LOGO_SRC, height: logo, width: logo, excavate: true }}
    />
  )
}

"use client"

/**
 * An in-page camera, for "scan a receipt" flows.
 *
 * A hidden `<input type="file" capture="environment">` only opens a real camera UI on mobile —
 * on a laptop it just opens the ordinary file picker, since desktop browsers have no concept of
 * `capture`. This opens `getUserMedia` directly and draws a live preview instead, so a shutter
 * button works the same way on a webcam as it does on a phone camera.
 */

import { useEffect, useRef, useState } from "react"
import { Camera, Loader2, X } from "lucide-react"

export default function CameraCapture({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera not available in this browser. Use Upload instead.")
      return
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play()
        }
        setReady(true)
      })
      .catch(() => {
        if (!cancelled) setError("Could not access the camera. Check permissions, or use Upload instead.")
      })

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const capture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return

    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.drawImage(video, 0, 0)

    canvas.toBlob((blob) => {
      if (blob) onCapture(new File([blob], "receipt.jpg", { type: "image/jpeg" }))
    }, "image/jpeg", 0.92)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-sm font-bold text-white">Scan receipt</p>
        <button onClick={onClose} aria-label="Close" className="p-2 rounded-full hover:bg-white/10 transition-colors">
          <X className="w-5 h-5 text-white" />
        </button>
      </div>

      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        {error ? (
          <p className="px-8 text-center text-sm font-medium text-white/70">{error}</p>
        ) : (
          <>
            {!ready && <Loader2 className="w-6 h-6 animate-spin text-white/50 absolute" />}
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} playsInline muted className="w-full h-full object-contain" />
          </>
        )}
      </div>

      <div className="py-6 flex items-center justify-center">
        <button
          onClick={capture}
          disabled={!ready || !!error}
          aria-label="Capture"
          className="w-16 h-16 rounded-full bg-white disabled:opacity-30 active:scale-95 transition-transform flex items-center justify-center"
        >
          <Camera className="w-6 h-6 text-black" />
        </button>
      </div>
    </div>
  )
}

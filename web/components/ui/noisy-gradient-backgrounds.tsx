"use client"

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react"

type GradientOrigin =
  | "bottom-middle"
  | "bottom-left"
  | "bottom-right"
  | "top-middle"
  | "top-left"
  | "top-right"
  | "left-middle"
  | "right-middle"
  | "center"

type GradientType = "radial-gradient" | "linear-gradient" | "conic-gradient"

interface GradientStop {
  color: string
  stop: string
}

interface NoiseProps {
  patternSize?: number
  patternScaleX?: number
  patternScaleY?: number
  patternRefreshInterval?: number
  patternAlpha?: number
  intensity?: number
}

function Noise({
  patternSize = 100,
  patternScaleX = 1,
  patternScaleY = 1,
  patternRefreshInterval = 0,
  patternAlpha = 24,
  intensity = 0.7,
}: NoiseProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context) return

    const tile = document.createElement("canvas")
    tile.width = patternSize
    tile.height = patternSize
    const tileContext = tile.getContext("2d")
    if (!tileContext) return

    const pixels = tileContext.createImageData(patternSize, patternSize)
    let cssWidth = 0
    let cssHeight = 0
    let frame = 0
    let animationFrame = 0

    const updatePattern = () => {
      for (let index = 0; index < pixels.data.length; index += 4) {
        const value = Math.random() * 255 * intensity
        pixels.data[index] = value
        pixels.data[index + 1] = value
        pixels.data[index + 2] = value
        pixels.data[index + 3] = patternAlpha
      }
      tileContext.putImageData(pixels, 0, 0)
    }

    const draw = () => {
      if (!cssWidth || !cssHeight) return
      const scaleX = Math.max(0.001, patternScaleX)
      const scaleY = Math.max(0.001, patternScaleY)
      const pattern = context.createPattern(tile, "repeat")
      if (!pattern) return

      context.clearRect(0, 0, cssWidth, cssHeight)
      context.save()
      context.scale(scaleX, scaleY)
      context.fillStyle = pattern
      context.fillRect(0, 0, cssWidth / scaleX, cssHeight / scaleY)
      context.restore()
    }

    const resize = () => {
      const bounds = canvas.parentElement?.getBoundingClientRect()
      if (!bounds) return
      cssWidth = bounds.width
      cssHeight = bounds.height
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.round(cssWidth * dpr))
      canvas.height = Math.max(1, Math.round(cssHeight * dpr))
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw()
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const animate = patternRefreshInterval > 0 && !reducedMotion
    const loop = () => {
      if (frame % patternRefreshInterval === 0) {
        updatePattern()
        draw()
      }
      frame += 1
      animationFrame = requestAnimationFrame(loop)
    }

    updatePattern()
    const observer = new ResizeObserver(resize)
    if (canvas.parentElement) observer.observe(canvas.parentElement)
    resize()
    if (animate) loop()

    return () => {
      observer.disconnect()
      if (animationFrame) cancelAnimationFrame(animationFrame)
    }
  }, [intensity, patternAlpha, patternRefreshInterval, patternScaleX, patternScaleY, patternSize])

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full mix-blend-soft-light" />
}

const POSITIONS: Record<GradientOrigin, string> = {
  "bottom-middle": "50% 101%",
  "bottom-left": "0% 101%",
  "bottom-right": "100% 101%",
  "top-middle": "50% -1%",
  "top-left": "0% -1%",
  "top-right": "100% -1%",
  "left-middle": "-1% 50%",
  "right-middle": "101% 50%",
  center: "50% 50%",
}

const ANGLES: Record<GradientOrigin, string> = {
  "bottom-middle": "0deg",
  "bottom-left": "45deg",
  "bottom-right": "315deg",
  "top-middle": "180deg",
  "top-left": "135deg",
  "top-right": "225deg",
  "left-middle": "90deg",
  "right-middle": "270deg",
  center: "0deg",
}

interface GradientBackgroundProps {
  gradientType?: GradientType
  gradientSize?: string
  gradientOrigin?: GradientOrigin
  colors?: GradientStop[]
  enableNoise?: boolean
  noisePatternSize?: number
  noisePatternScaleX?: number
  noisePatternScaleY?: number
  noisePatternRefreshInterval?: number
  noisePatternAlpha?: number
  noiseIntensity?: number
  className?: string
  style?: CSSProperties
  children?: ReactNode
  customGradient?: string
}

export function GradientBackground({
  gradientType = "radial-gradient",
  gradientSize = "125% 125%",
  gradientOrigin = "bottom-middle",
  colors = [
    { color: "#B97819", stop: "0%" },
    { color: "#E7B85C", stop: "28%" },
    { color: "#F8E3AE", stop: "62%" },
    { color: "#FFFDF8", stop: "100%" },
  ],
  enableNoise = true,
  noisePatternSize = 100,
  noisePatternScaleX = 1,
  noisePatternScaleY = 1,
  noisePatternRefreshInterval = 0,
  noisePatternAlpha = 24,
  noiseIntensity = 0.7,
  className = "",
  style,
  children,
  customGradient,
}: GradientBackgroundProps) {
  const stops = colors.map(({ color, stop }) => `${color} ${stop}`).join(",")
  const position = POSITIONS[gradientOrigin]
  const background =
    customGradient ??
    (gradientType === "radial-gradient"
      ? `radial-gradient(${gradientSize} at ${position},${stops})`
      : gradientType === "linear-gradient"
        ? `linear-gradient(${ANGLES[gradientOrigin]},${stops})`
        : `conic-gradient(from 0deg at ${position},${stops})`)

  return (
    <div className={`absolute inset-0 h-full w-full ${className}`} style={{ background, ...style }}>
      {enableNoise && (
        <Noise
          patternSize={noisePatternSize}
          patternScaleX={noisePatternScaleX}
          patternScaleY={noisePatternScaleY}
          patternRefreshInterval={noisePatternRefreshInterval}
          patternAlpha={noisePatternAlpha}
          intensity={noiseIntensity}
        />
      )}
      {children}
    </div>
  )
}

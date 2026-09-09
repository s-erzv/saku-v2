import type { Metadata, Viewport } from "next"
import type React from "react"
import { Caveat, Geist, Geist_Mono, Space_Mono } from "next/font/google"
import { AuthProvider } from "@/hooks/useAuth"
import { MpcWalletProvider } from "@/hooks/useMpcWallet"
import MiniAppReady from "./miniapp-ready"
import ServiceWorkerRegister from "./service-worker-register"
import "./globals.css"

const geist = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-geist",
  display: "swap",
  preload: true,
})

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-geist-mono",
  display: "swap",
  preload: true,
})

/**
 * Receipt-only face. Geist Mono is the app's code/hash font; a receipt wants the wider, slightly
 * typewriter-ish letterforms of a till printer instead. Exposed as a CSS variable because
 * `lib/receipt-image.ts` has to read the family name back out at runtime — next/font hashes it,
 * so the literal string "Space Mono" would never match in a canvas `ctx.font`.
 */
const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-receipt",
  display: "swap",
  preload: true,
})

/**
 * The hand a packet's note is written in.
 *
 * A letter tucked inside an envelope is the one place in this app where the app is not talking —
 * a person is. Setting it in the same bold sans as every button would make it read as another
 * label; a hand makes it read as something someone wrote.
 */
const caveat = Caveat({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-letter",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Saku - Fast Payment",
  description: "A phone-number wallet. Send, top up, split bills and cash out to an e-wallet.",
  manifest: "/manifest.json",
  applicationName: "Saku",
  icons: {
    // Transparent, like `logo.png` always was — a white-backed favicon reads as a white box
    // against a dark tab strip.
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    // 180x180 on a solid ground: iOS ignores alpha, composites it onto black, and rounds the
    // corners itself — this is the one place a background is the correct answer.
    apple: "/icons/apple-touch-icon.png",
    shortcut: "/icons/favicon-32.png",
  },
  appleWebApp: {
    // iOS only honours the manifest for the icon; standalone display and the title under it come
    // from these meta tags instead.
    capable: true,
    title: "Saku",
    statusBarStyle: "default",
  },
  other: {
    "base:app_id": "6978230488e3bac59cf3da96",
  },
}

/**
 * The brand accent, not white. `theme_color` paints the browser/OS chrome around an installed
 * app, and orange is the one colour that identifies Saku at a glance in a task switcher — white
 * would make the installed app indistinguishable from every other page. The splash screen
 * (`background_color` in the manifest) stays white so the mark sits on the app's real ground.
 */
export const viewport: Viewport = {
  themeColor: "#F0A353",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`overflow-x-hidden ${geist.variable} ${geistMono.variable} ${spaceMono.variable} ${caveat.variable}`}>
      <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.3.2/css/flag-icons.min.css" />
        {/*
          The CSP lives in middleware.ts, as a header, and only there. A <meta> CSP here used to
          declare a second, narrower policy — browsers enforce the intersection of the two, so
          the stricter one silently won and any host added to the header
          stayed blocked with no obvious cause.
        */}
      </head>
      <body className="font-sans antialiased overflow-x-hidden">
        <MiniAppReady />
        <ServiceWorkerRegister />
        <AuthProvider>
          <MpcWalletProvider>{children}</MpcWalletProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
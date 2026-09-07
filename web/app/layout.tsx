import type { Metadata } from "next"
import type React from "react"
import { Geist, Geist_Mono } from "next/font/google"
import { AuthProvider } from "@/hooks/useAuth"
import { MpcWalletProvider } from "@/hooks/useMpcWallet"
import MiniAppReady from "./miniapp-ready"
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

export const metadata: Metadata = {
  title: "Saku - Fast Payment",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
    shortcut: "/logo.png",
  },
  other: {
    "base:app_id": "6978230488e3bac59cf3da96",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`overflow-x-hidden ${geist.variable} ${geistMono.variable}`}>
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
        <AuthProvider>
          <MpcWalletProvider>{children}</MpcWalletProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
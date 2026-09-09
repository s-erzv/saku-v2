"use client"

/**
 * What "wallet security" means under Turnkey key management (PRD Fase 4, revised).
 *
 * There is no factor for the user to enroll here — the old "add a recovery phrase" upgrade
 * path was a property of Web3Auth's threshold shares, and Turnkey's server-side signing model
 * has no client-held share to add one to. Verifying an OTP for this phone number is, on its
 * own, what reaches the wallet. That is stated plainly rather than framed as a temporary or
 * incomplete state, because it is not one: it is what this architecture actually does.
 */

import { ShieldCheck } from "lucide-react"
import { useMpcWallet } from "@/hooks/useMpcWallet"

export default function WalletSecurity() {
  const { status } = useMpcWallet()

  if (status !== "connected") return null

  return (
    <div className="bg-white rounded-[2rem] border border-border/50 p-6 shadow-sm space-y-3">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-emerald-50 p-2.5">
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-bold tracking-tight">Wallet security</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Your key lives inside Turnkey, never on this device. Nothing to write down.
          </p>
        </div>
      </div>
    </div>
  )
}

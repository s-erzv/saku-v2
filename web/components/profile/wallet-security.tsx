"use client"

/**
 * What "wallet security" means under server-side key management (PRD Fase 4, revised).
 *
 * There is no factor for the user to enroll here — the old "add a recovery phrase" upgrade path
 * was a property of Web3Auth's threshold shares, and a server-side signing model has no
 * client-held share to add one to. Verifying an OTP for this phone number is, on its own, what
 * reaches the wallet. That is stated plainly rather than framed as a temporary or incomplete
 * state, because it is not one: it is what this architecture actually does.
 *
 * No custodian is named, here or anywhere else a user can read. The copy below named one, and
 * went on naming it long after it had stopped being the answer, which is the whole argument
 * against naming one at all: the provider is an implementation detail that has already changed
 * once, and a user cannot act on the name either way. What they can act on is where the key is
 * not, and what reaches it.
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
            Your key never touches this device. Passing the code sent to your number is what
            reaches it, so there is nothing for you to write down.
          </p>
        </div>
      </div>
    </div>
  )
}

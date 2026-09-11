"use client"

/**
 * What protects the key, as one line in the Security group.
 *
 * It was a full card with a heading and a paragraph, sitting between two other full cards. The
 * paragraph never changes and there is nothing to do about it, so it was costing a card's worth
 * of a short screen to reassure someone once. The reassurance still matters — it is the answer
 * to "where is my seed phrase?" — so the sentence is still here, as the row's own description.
 *
 * Still renders nothing until the signing provider reports a connected wallet: saying the key is
 * safe while the wallet is not up yet would be a claim this screen cannot check.
 */

import { ShieldCheck } from "lucide-react"
import { useMpcWallet } from "@/hooks/useMpcWallet"
import SettingsRow from "@/components/profile/settings-row"

export default function WalletSecurity() {
  const { status } = useMpcWallet()

  if (status !== "connected") return null

  return (
    <SettingsRow
      icon={ShieldCheck}
      iconClassName="bg-emerald-50 text-emerald-600"
      label="Wallet security"
      description="Your key never touches this device — nothing for you to write down."
      value="Protected"
    />
  )
}

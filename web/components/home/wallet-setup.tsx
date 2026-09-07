"use client"

import { useEffect, useRef, useState } from "react"
import { KeyRound, Loader2 } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useMpcWallet } from "@/hooks/useMpcWallet"

/**
 * Wallet bring-up on the home screen — and deliberately nothing else.
 *
 * There is no seed-phrase ceremony here, on purpose: the persona in PRD Section 3 has never
 * handled one, and this key is not held on-device at all. Turnkey holds it, gated by a valid
 * Saku session — passing the WhatsApp OTP is what reaches the wallet, on any device, every
 * time. That is the Social Identity Abstraction bargain the product is built on, stated plainly
 * in the profile screen (`components/profile/wallet-security.tsx`) rather than implied.
 */
export default function WalletSetup() {
  const { token, refreshUser } = useAuth()
  const { status, login } = useMpcWallet()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const autoCreationAttempted = useRef(false)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  // Derive the wallet automatically. A user who just proved they own the phone number should
  // not also have to press "create wallet" — there is no decision for them to make here.
  useEffect(() => {
    if (autoCreationAttempted.current) return
    if (!token) return
    if (status !== "idle") return

    autoCreationAttempted.current = true

    const create = async () => {
      setBusy(true)
      setError(null)
      try {
        await login(token)
        await refreshUser()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Wallet creation failed")
      } finally {
        setBusy(false)
      }
    }

    void create()
  }, [token, status, login, refreshUser])

  if (status !== "connected") {
    return (
      <div className="rounded-3xl bg-white border border-slate-200 p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-amber-50 p-2.5">
            {busy ? (
              <Loader2 className="w-5 h-5 text-amber-600 animate-spin" />
            ) : (
              <KeyRound className="w-5 h-5 text-amber-600" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 tracking-tight">
              {busy ? "Setting up your wallet…" : "Wallet"}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {busy
                ? "Just a moment — this happens once."
                : "Verifying your number opens your wallet — nothing to write down, nothing to lose."}
            </p>
          </div>
        </div>

        {error && (
          <>
            <p className="mt-2 text-xs font-medium text-red-600">{error}</p>
            <button
              disabled={busy || !token}
              onClick={() => run(async () => { await login(token!); await refreshUser() })}
              className="mt-3 w-full rounded-2xl bg-slate-900 py-3 text-sm font-bold text-white disabled:opacity-40 active:scale-[0.99] transition-transform"
            >
              Try again
            </button>
          </>
        )}
      </div>
    )
  }

  return null
}

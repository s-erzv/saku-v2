"use client"

/**
 * Saku session state.
 *
 * The session is an httpOnly cookie set by `/api/verify-otp`. This hook never sees it, never
 * stores it, and could not hand it to anything if it wanted to — that is the point. It used to
 * hold a bearer token in `localStorage` and attach it to every request by hand, which meant any
 * script injection anywhere in the app could read the authority to move a user's money and post
 * it somewhere. See `lib/session.ts` for the full reasoning.
 *
 * What is left here is a question with a yes/no answer: does `/api/me` recognise this browser?
 * Requests carry the cookie automatically because they are same-origin, so nothing else is
 * needed at any call site.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { forgetDeviceHistory } from '@/lib/recent-recipients'

export interface SakuUser {
  id: string
  /** keccak256 of the phone number. The number itself is not stored anywhere in Saku. */
  phone_hash: string
  display_name: string | null
  avatar_url: string | null
  country_code: string
  /**
   * The dialling code and last four digits of the verified number — the only part of it that is
   * written down, so that the profile screen can show the holder which number this account is.
   * See `db/migrations/2026-09-11-phone-hint.sql`.
   *
   * Null for any account that has not signed in since that migration landed: the rest of the
   * number is an HMAC and nothing could have backfilled these from it.
   */
  phone_dial_code?: string | null
  phone_last4?: string | null
}

export interface SakuWallet {
  address: string
  chain_id: number
  /**
   * Vestigial. Written as 1 at provisioning and never incremented — it counted key shares under
   * a custody model this app no longer uses. Recovery status comes from {@link RecoveryStatus}.
   */
  factors_enrolled: number
}

/** What actually stands between this account and being unrecoverable. */
export interface RecoveryStatus {
  emailVerified: boolean
  /** Approved and past the cooling period, so usable today. */
  activeGuardians: number
  /** Invited or approved-but-cooling. Real, but not yet able to help. */
  pendingGuardians: number
  /** A confirmed email AND an active guardian: a recovery started today could finish. */
  ready: boolean
  /** How long until the soonest cooling guardian can help, or null when none is on the way. */
  guardianReadyInMs: number | null
}

const NO_RECOVERY: RecoveryStatus = {
  emailVerified: false,
  activeGuardians: 0,
  pendingGuardians: 0,
  ready: false,
  guardianReadyInMs: null,
}

interface AuthContextType {
  user: SakuUser | null
  wallet: SakuWallet | null
  isAuthenticated: boolean
  isLoading: boolean
  /** No wallet address recorded yet — provisioning has not completed. */
  needsWalletSetup: boolean
  /** No verified email and no usable guardian: losing the number loses the account. */
  needsRecoveryFactor: boolean
  recovery: RecoveryStatus
  logout: () => Promise<void>
  /**
   * Re-reads `/api/me` and returns what it found, so a caller that needs the freshly signed-in
   * user — `get-started`, which has to key this device's copy of the number by `phone_hash` —
   * does not have to read it out of a state value its own closure captured before the fetch.
   */
  refreshUser: () => Promise<SakuUser | null>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SakuUser | null>(null)
  const [wallet, setWallet] = useState<SakuWallet | null>(null)
  const [needsWalletSetup, setNeedsWalletSetup] = useState(false)
  const [needsRecoveryFactor, setNeedsRecoveryFactor] = useState(false)
  const [recovery, setRecovery] = useState<RecoveryStatus>(NO_RECOVERY)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  const clearLocalState = useCallback(() => {
    setUser(null)
    setWallet(null)
    setNeedsWalletSetup(false)
    setNeedsRecoveryFactor(false)
    setRecovery(NO_RECOVERY)
  }, [])

  const refreshUser = useCallback(async (): Promise<SakuUser | null> => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/me')

      // 401 means the cookie is absent, expired, forged, revoked, or points at a user that no
      // longer exists. All of those are "signed out" as far as this browser is concerned.
      if (response.status === 401) {
        clearLocalState()
        return null
      }
      if (!response.ok) return null

      const data = await response.json()
      setUser(data.user)
      setWallet(data.wallet)
      setNeedsWalletSetup(data.needsWalletSetup)
      setNeedsRecoveryFactor(data.needsRecoveryFactor)
      if (data.recovery) setRecovery(data.recovery)
      return data.user as SakuUser
    } catch {
      // Network failure, not an auth failure — leave the current state alone so a reload can
      // recover rather than bouncing someone to the sign-in screen because their train went
      // through a tunnel.
      return null
    } finally {
      setIsLoading(false)
    }
  }, [clearLocalState])

  useEffect(() => {
    refreshUser()
  }, [refreshUser])

  /**
   * Signing out is a server call now, not a local delete.
   *
   * `/api/logout` bumps `users.token_version`, which invalidates every token ever issued to this
   * account — so a session that was captured before the user signed out stops working at that
   * moment instead of living out its full life. Clearing local state without that call would put
   * the sign-in screen in front of the user while leaving the session itself very much alive.
   */
  const logout = useCallback(async () => {
    // Read before the state clears: these caches are keyed by the signed-in user's hash, and
    // after `clearLocalState` there is nothing left to key them by.
    const scope = user?.phone_hash

    try {
      await fetch('/api/logout', { method: 'POST' })
    } catch {
      // The cookie may survive a failed request, so this is not a silent success. Sending the
      // user to the sign-in screen anyway is still right: staying put would strand them on a
      // screen they asked to leave.
      console.error('[auth] sign-out request failed; the session may still be live')
    } finally {
      // Recipients' phone numbers, saved bank accounts, cached contact numbers — the plain values
      // the server deliberately never holds. Signing out is when someone expects them gone.
      forgetDeviceHistory(scope)
      localStorage.removeItem('saku_has_seen_onboarding')
      localStorage.removeItem('saku_just_registered')
      clearLocalState()
      router.replace('/get-started')
    }
  }, [clearLocalState, router, user?.phone_hash])

  return (
    <AuthContext.Provider value={{
      user,
      wallet,
      isAuthenticated: !!user,
      isLoading,
      needsWalletSetup,
      needsRecoveryFactor,
      recovery,
      logout,
      refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) throw new Error('useAuth must be used within AuthProvider')
  return context
}

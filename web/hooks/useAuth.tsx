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
}

export interface SakuWallet {
  address: string
  chain_id: number
  /** 1 = device factor only; losing this browser loses the wallet. */
  factors_enrolled: number
}

interface AuthContextType {
  user: SakuUser | null
  wallet: SakuWallet | null
  isAuthenticated: boolean
  isLoading: boolean
  /** No wallet address recorded yet — provisioning has not completed. */
  needsWalletSetup: boolean
  /** Wallet exists but has no recovery factor, so it is one cleared browser from being lost. */
  needsRecoveryFactor: boolean
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SakuUser | null>(null)
  const [wallet, setWallet] = useState<SakuWallet | null>(null)
  const [needsWalletSetup, setNeedsWalletSetup] = useState(false)
  const [needsRecoveryFactor, setNeedsRecoveryFactor] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  const clearLocalState = useCallback(() => {
    setUser(null)
    setWallet(null)
    setNeedsWalletSetup(false)
    setNeedsRecoveryFactor(false)
  }, [])

  const refreshUser = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/me')

      // 401 means the cookie is absent, expired, forged, revoked, or points at a user that no
      // longer exists. All of those are "signed out" as far as this browser is concerned.
      if (response.status === 401) {
        clearLocalState()
        return
      }
      if (!response.ok) return

      const data = await response.json()
      setUser(data.user)
      setWallet(data.wallet)
      setNeedsWalletSetup(data.needsWalletSetup)
      setNeedsRecoveryFactor(data.needsRecoveryFactor)
    } catch {
      // Network failure, not an auth failure — leave the current state alone so a reload can
      // recover rather than bouncing someone to the sign-in screen because their train went
      // through a tunnel.
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

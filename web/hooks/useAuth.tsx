"use client"

/**
 * Saku session state.
 *
 * v1 read the phone number out of the JWT and looked the user up in `profiles` with the anon
 * key. Neither works in v2 and neither should: the token carries only a hash, and every table
 * is RLS-on with no permissive policy, so the browser has no direct read path to identity. The
 * account now comes from `/api/me`, which is the one place the session token is verified.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

const TOKEN_KEY = 'saku_auth_token'

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
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  /** No wallet address recorded yet — the MPC login has not completed. */
  needsWalletSetup: boolean
  /** Wallet exists but has no recovery factor, so it is one cleared browser from being lost. */
  needsRecoveryFactor: boolean
  logout: () => void
  refreshUser: () => Promise<void>
  setToken: (token: string) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SakuUser | null>(null)
  const [wallet, setWallet] = useState<SakuWallet | null>(null)
  const [token, setTokenState] = useState<string | null>(null)
  const [needsWalletSetup, setNeedsWalletSetup] = useState(false)
  const [needsRecoveryFactor, setNeedsRecoveryFactor] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  const clearSession = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setUser(null)
    setWallet(null)
    setTokenState(null)
  }, [])

  const refreshUser = useCallback(async () => {
    setIsLoading(true)
    try {
      const savedToken = localStorage.getItem(TOKEN_KEY)
      if (!savedToken) {
        clearSession()
        return
      }

      const response = await fetch('/api/me', {
        headers: { Authorization: `Bearer ${savedToken}` },
      })

      // 401 means the token is expired, forged, or points at a user that no longer exists.
      // Any of those is "logged out" — keeping the token around only causes silent retries.
      if (response.status === 401) {
        clearSession()
        return
      }
      if (!response.ok) return

      const data = await response.json()
      setUser(data.user)
      setWallet(data.wallet)
      setNeedsWalletSetup(data.needsWalletSetup)
      setNeedsRecoveryFactor(data.needsRecoveryFactor)
      setTokenState(savedToken)
    } catch {
      // Network failure, not an auth failure — keep the token so a reload can recover.
    } finally {
      setIsLoading(false)
    }
  }, [clearSession])

  useEffect(() => {
    refreshUser()
  }, [refreshUser])

  const logout = useCallback(() => {
    clearSession()
    router.replace('/get-started')
  }, [clearSession, router])

  const setToken = useCallback((newToken: string) => {
    localStorage.setItem(TOKEN_KEY, newToken)
    setTokenState(newToken)
  }, [])

  return (
    <AuthContext.Provider value={{
      user,
      wallet,
      token,
      isAuthenticated: !!user && !!token,
      isLoading,
      needsWalletSetup,
      needsRecoveryFactor,
      logout,
      refreshUser,
      setToken,
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

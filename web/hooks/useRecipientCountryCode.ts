"use client"

/**
 * The dialing code a recipient picker should start on: the signed-in user's own country.
 *
 * Drop-in for the `useState("+62")` that every one of these screens used to open with. The
 * hardcoded default was wrong for five of the six countries Saku supports, and wrong in a way
 * that does not announce itself — the dialing code is part of what `lib/phone.ts` hashes, so a
 * Malaysian who forgets to change the picker does not get an error, they get a stranger's
 * identity hash and a transfer that resolves to the wrong person or to nobody.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { dialCodeFromCountry } from '@/lib/currency'

export function useRecipientCountryCode(): readonly [string, (next: string) => void] {
  const { user } = useAuth()
  const [countryCode, setCountryCode] = useState(() => dialCodeFromCountry(user?.country_code))

  /**
   * Whether the person has picked a country themselves. `user` arrives asynchronously and
   * changes again on every `refreshUser`, so without this the hook would happily overwrite a
   * deliberate choice — someone selecting Singapore to pay a friend there would be silently put
   * back on their own country a moment later.
   */
  const chosenByUser = useRef(false)

  useEffect(() => {
    if (chosenByUser.current || !user?.country_code) return
    setCountryCode(dialCodeFromCountry(user.country_code))
  }, [user?.country_code])

  const choose = useCallback((next: string) => {
    chosenByUser.current = true
    setCountryCode(next)
  }, [])

  return [countryCode, choose] as const
}

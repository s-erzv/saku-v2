"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { ArrowLeft, ShieldCheck } from "lucide-react"
import CountryCodeDropdown from "@/components/get-started/country-code-dropdown"
import { OTP_LENGTH } from "@/lib/otp-shape"
import { rememberOwnNumber } from "@/lib/own-number"
import { useAuth } from "@/hooks/useAuth"
import { useMpcWallet } from "@/hooks/useMpcWallet"

const MIN_NATIONAL_DIGITS = 6
const RESEND_COOLDOWN_S = 60

function extensionSurfaceHeaders() {
  return new URLSearchParams(window.location.search).get("surface") === "sidepanel"
    ? { "X-Saku-Surface": "extension" }
    : undefined
}

function fullPhone(phone: string, dialCode: string) {
  const digits = phone.replace(/\D/g, "")
  const country = dialCode.replace(/\D/g, "")
  if (digits.startsWith("0")) return `${country}${digits.replace(/^0+/, "")}`
  return digits.startsWith(country) ? digits : `${country}${digits}`
}

export default function ExtensionLogin() {
  const { refreshUser } = useAuth()
  const { login: provisionWallet } = useMpcWallet()
  const [step, setStep] = useState<"phone" | "code" | "wallet">("phone")
  const [phone, setPhone] = useState("")
  const [dialCode, setDialCode] = useState("+62")
  const [code, setCode] = useState(() => Array<string>(OTP_LENGTH).fill(""))
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  const submitting = useRef(false)

  const requestCode = useCallback(
    async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch("/api/request-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...extensionSurfaceHeaders() },
          body: JSON.stringify({
            phone: fullPhone(phone, dialCode),
            countryCode: dialCode.replace(/\D/g, ""),
          }),
        })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || "Could not send a code. Try again.")

        setStep("code")
        setCode(Array<string>(OTP_LENGTH).fill(""))
        setSecondsLeft(RESEND_COOLDOWN_S)
        window.setTimeout(() => inputs.current[0]?.focus(), 60)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not send a code. Try again.")
      } finally {
        setLoading(false)
      }
    },
    [dialCode, phone]
  )

  useEffect(() => {
    if (secondsLeft <= 0) return
    const timer = window.setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [secondsLeft])

  const verifyCode = useCallback(
    async (value: string) => {
      if (submitting.current || value.length !== OTP_LENGTH) return
      submitting.current = true
      setLoading(true)
      setError(null)

      try {
        const response = await fetch("/api/verify-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...extensionSurfaceHeaders() },
          body: JSON.stringify({
            phone: fullPhone(phone, dialCode),
            otp: value,
            countryCode: dialCode.replace(/\D/g, ""),
          }),
        })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || "That code did not work. Try again.")

        if (body.isNewUser) {
          localStorage.setItem("saku_just_registered", "true")
          localStorage.removeItem("saku_has_seen_onboarding")
        }

        setStep("wallet")
        try {
          await provisionWallet()
        } catch {
          // The valid session is enough to continue. The existing wallet setup can resume on Home.
        }
        const signedIn = await refreshUser()
        rememberOwnNumber(signedIn?.phone_hash, fullPhone(phone, dialCode), dialCode)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "That code did not work. Try again.")
        setCode(Array<string>(OTP_LENGTH).fill(""))
        submitting.current = false
        window.setTimeout(() => inputs.current[0]?.focus(), 0)
      } finally {
        setLoading(false)
      }
    },
    [dialCode, phone, provisionWallet, refreshUser]
  )

  const fillCode = (digits: string, start: number) => {
    const next = [...code]
    let cursor = start
    for (const digit of digits.replace(/\D/g, "")) {
      if (cursor === OTP_LENGTH) break
      next[cursor] = digit
      cursor += 1
    }
    setCode(next)
    setError(null)

    if (!next.includes("")) {
      inputs.current[OTP_LENGTH - 1]?.blur()
      void verifyCode(next.join(""))
    } else {
      inputs.current[Math.min(cursor, OTP_LENGTH - 1)]?.focus()
    }
  }

  const canRequest = phone.replace(/\D/g, "").length >= MIN_NATIONAL_DIGITS && !loading

  if (step === "wallet") {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#0B0B09] px-7 text-center text-white">
        <div role="status" aria-live="polite">
          <Image src="/icons/saku-mark.png" alt="" width={56} height={56} className="mx-auto animate-pulse rounded-2xl" />
          <h1 className="mt-6 text-xl font-semibold tracking-tight">Preparing your wallet</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/55">Securing your Saku session and loading your account.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-dvh flex-col bg-[#0B0B09] px-5 pb-8 pt-6 text-white">
      <header className="flex items-center gap-2.5">
        {step === "code" ? (
          <button
            type="button"
            onClick={() => {
              setStep("phone")
              setError(null)
              submitting.current = false
            }}
            className="-ml-2 rounded-xl p-2 text-white/70 transition-colors hover:bg-white/[0.07] hover:text-white"
            aria-label="Back to phone number"
          >
            <ArrowLeft size={19} />
          </button>
        ) : (
          <Image src="/icons/saku-mark.png" alt="" width={32} height={32} className="rounded-lg" />
        )}
        <span className="text-[15px] font-semibold tracking-tight">Saku</span>
      </header>

      <div className="flex flex-1 flex-col justify-center pb-12">
        {step === "phone" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (canRequest) void requestCode()
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#E8C96F]">Saku extension</p>
            <h1 className="mt-3 text-[30px] font-semibold leading-tight tracking-[-0.035em]">Sign in to your wallet</h1>
            <p className="mt-3 text-[14px] leading-relaxed text-white/55">Use your WhatsApp number. Saku never asks for a seed phrase or password.</p>

            <div className="relative mt-8">
              <CountryCodeDropdown selectedCode={dialCode} onSelect={setDialCode} />
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                autoFocus
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value)
                  setError(null)
                }}
                placeholder="812 3456 7890"
                className="w-full rounded-2xl border border-white/15 bg-white/[0.06] py-4 pl-28 pr-4 text-lg font-semibold tabular-nums text-white outline-none transition-colors placeholder:text-white/25 focus:border-[#E8C96F] focus:bg-white/[0.09]"
              />
            </div>

            <p role="alert" className="mt-3 min-h-5 text-[13px] text-[#FF9F8F]">{error}</p>

            <button
              type="submit"
              disabled={!canRequest}
              className="mt-4 w-full rounded-2xl bg-[#E8C96F] py-4 text-[15px] font-semibold text-[#17130B] transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
            >
              {loading ? "Sending code..." : "Continue"}
            </button>

            <Link href="/recover" className="mt-5 block text-center text-[13px] font-medium text-white/55 underline underline-offset-4 transition-colors hover:text-white">
              Cannot receive the code?
            </Link>
          </form>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void verifyCode(code.join(""))
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#E8C96F]">Verification</p>
            <h1 className="mt-3 text-[30px] font-semibold leading-tight tracking-[-0.035em]">Check WhatsApp</h1>
            <p className="mt-3 text-[14px] leading-relaxed text-white/55">Enter the six-digit code we sent to your number.</p>

            <div
              className="mt-8 flex gap-2"
              onPaste={(event) => {
                const pasted = event.clipboardData.getData("text")
                if (!pasted) return
                event.preventDefault()
                fillCode(pasted, 0)
              }}
            >
              {code.map((digit, index) => (
                <input
                  key={index}
                  ref={(element) => { inputs.current[index] = element }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete={index === 0 ? "one-time-code" : "off"}
                  maxLength={1}
                  value={digit}
                  disabled={loading}
                  onChange={(event) => fillCode(event.target.value, index)}
                  onKeyDown={(event) => {
                    if (event.key === "Backspace" && !digit && index > 0) inputs.current[index - 1]?.focus()
                  }}
                  className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/[0.06] py-3.5 text-center text-xl font-semibold tabular-nums text-white outline-none transition-colors focus:border-[#E8C96F] focus:bg-white/[0.09]"
                  aria-label={`Digit ${index + 1} of ${OTP_LENGTH}`}
                />
              ))}
            </div>

            <p role="alert" className="mt-3 min-h-5 text-center text-[13px] text-[#FF9F8F]">{error}</p>

            <button
              type="submit"
              disabled={loading || code.includes("")}
              className="mt-3 w-full rounded-2xl bg-[#E8C96F] py-4 text-[15px] font-semibold text-[#17130B] transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
            >
              {loading ? "Verifying..." : "Verify"}
            </button>

            <p className="mt-5 text-center text-[13px] text-white/50">
              {secondsLeft > 0 ? `You can request a new code in ${secondsLeft}s` : (
                <button type="button" onClick={() => void requestCode()} disabled={loading} className="font-medium text-[#E8C96F] hover:text-[#F6D889] disabled:opacity-50">
                  Send a new code
                </button>
              )}
            </p>
          </form>
        )}
      </div>

      <p className="flex items-start gap-2 text-[11px] leading-relaxed text-white/38">
        <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-[#E8C96F]/70" />
        Your code expires in five minutes. Never share it with anyone.
      </p>
    </main>
  )
}

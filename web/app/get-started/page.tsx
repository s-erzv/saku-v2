"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/useAuth"
import { useMpcWallet } from "@/hooks/useMpcWallet"
import { toast } from "sonner"
import CountryCodeDropdown from "@/components/get-started/country-code-dropdown"
import { ArrowLeft, ShieldCheck } from "lucide-react"
import { OTP_LENGTH } from "@/lib/otp-shape"

/**
 * National numbers are shorter outside Indonesia — Malaysia runs to nine digits without its
 * leading zero and Singapore to eight, both of which a ten-digit floor rejected outright. This
 * only stops an obviously half-typed number; `lib/phone.ts` does the real E.164 check
 * server-side, and it is the one that should decide.
 */
const MIN_NATIONAL_DIGITS = 6


/**
 * How long before "Send a new code" comes back.
 *
 * Matched to the server, not picked for feel: `/api/request-otp` allows three codes per phone
 * per five minutes, so roughly one every hundred seconds. A shorter timer would hand people a
 * live button that answers 429, which reads as the app being broken rather than as a limit.
 */
const RESEND_COOLDOWN_S = 60

/**
 * The three things that have to happen before someone is inside the app, in order. This is a
 * genuine sequence rather than decoration, which is what earns it a visible rail: the wallet
 * step in particular is a wait nobody expects, and a screen that says nothing about it looks
 * frozen. The rail also replaces the back-link-plus-heading chrome each step used to repeat.
 */
const STEPS = ["Number", "Code", "Wallet"] as const
type Step = (typeof STEPS)[number]

/** `+62` + `81234567890` → `+62 812 3456 7890`, for reading back the number we sent to. */
function formatForDisplay(dialCode: string, national: string): string {
  const digits = national.replace(/\D/g, "").replace(/^0+/, "")
  const groups = digits.match(/.{1,4}/g) ?? []
  return `${dialCode} ${groups.join(" ")}`.trim()
}

export default function LoginScreen() {
  const router = useRouter()
  const { refreshUser, isAuthenticated, isLoading } = useAuth()
  const { login: mpcLogin } = useMpcWallet()

  const [step, setStep] = useState<"intro" | "phone" | "code">("intro")
  const [phone, setPhone] = useState("")
  const [selectedCountryCode, setSelectedCountryCode] = useState("+62")
  const [code, setCode] = useState<string[]>(new Array(OTP_LENGTH).fill(""))
  const [loading, setLoading] = useState(false)
  // Verifying the code and provisioning the wallet are two visibly different waits — the second
  // is a round trip to the signing provider, so labelling it "Verifying" would look frozen.
  const [phase, setPhase] = useState<"verifying" | "wallet">("verifying")
  // Shown under the field it belongs to. A toast is easy to miss above the thumb, and on the
  // code screen the eye is already fixed on the row that just failed.
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)

  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  // Guards the auto-submit that fires when the last box is filled, so a paste and a keystroke
  // landing in the same tick cannot post the code twice.
  const submitting = useRef(false)

  useEffect(() => {
    if (!isLoading && isAuthenticated) router.replace("/home")
  }, [isAuthenticated, isLoading, router])

  useEffect(() => {
    if (secondsLeft <= 0) return
    const timer = window.setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [secondsLeft])

  const currentStep: Step = step === "code" ? (phase === "wallet" ? "Wallet" : "Code") : "Number"
  const nationalDigits = phone.replace(/\D/g, "").length
  const canSendCode = nationalDigits >= MIN_NATIONAL_DIGITS && !loading

  const formatPhone = useCallback(
    (num: string) => {
      const cleanNum = num.replace(/\D/g, "")
      const countryCode = selectedCountryCode.replace("+", "")
      if (cleanNum.startsWith("0")) return `${countryCode}${cleanNum.slice(1)}`
      return cleanNum.startsWith(countryCode) ? cleanNum : `${countryCode}${cleanNum}`
    },
    [selectedCountryCode]
  )

  const displayNumber = useMemo(
    () => formatForDisplay(selectedCountryCode, phone),
    [selectedCountryCode, phone]
  )

  const failCode = useCallback((message: string) => {
    setError(message)
    setShake(true)
    window.setTimeout(() => setShake(false), 450)
  }, [])

  const requestCode = useCallback(
    async (isResend: boolean) => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch("/api/request-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: formatPhone(phone),
            countryCode: selectedCountryCode.replace("+", ""),
          }),
        })
        const result = await res.json()
        if (!res.ok) throw new Error(result.error || "We couldn't send the code. Try again.")

        setStep("code")
        setCode(new Array(OTP_LENGTH).fill(""))
        setSecondsLeft(RESEND_COOLDOWN_S)
        if (isResend) toast.success("New code sent")
        window.setTimeout(() => inputRefs.current[0]?.focus(), 60)
      } catch (err) {
        const message = err instanceof Error ? err.message : "We couldn't send the code. Try again."
        setError(message)
        if (isResend) failCode(message)
      } finally {
        setLoading(false)
      }
    },
    [failCode, formatPhone, phone, selectedCountryCode]
  )

  const verifyCode = useCallback(
    async (value: string) => {
      if (submitting.current || value.length !== OTP_LENGTH) return
      submitting.current = true
      setLoading(true)
      setError(null)

      try {
        const res = await fetch("/api/verify-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The dialling code has to ride along: the server derives the user's country from it
          // at signup, which is what decides the currency they are billed in later.
          body: JSON.stringify({
            phone: formatPhone(phone),
            otp: value,
            countryCode: selectedCountryCode.replace("+", ""),
          }),
        })
        const result = await res.json()
        if (!res.ok) throw new Error(result.error || "That code didn't work. Try again.")

        if (result.isNewUser) {
          localStorage.setItem("saku_just_registered", "true")
          localStorage.removeItem("saku_has_seen_onboarding")
        }

        // Nothing to store. The session arrived as an httpOnly cookie on this response and every
        // request from here on carries it automatically — see `lib/session.ts`.

        // Derive the wallet now rather than on the home screen, so the user lands on a screen
        // that already has an address. A failure here is not fatal: home offers the same step
        // again, and the session is already valid either way.
        setPhase("wallet")
        try {
          await mpcLogin()
        } catch {
          toast.error("Wallet setup didn't finish. You can pick it up again from home.")
        }

        await refreshUser()
        router.push("/home")
      } catch (err) {
        failCode(err instanceof Error ? err.message : "That code didn't work. Try again.")
        setPhase("verifying")
        setCode(new Array(OTP_LENGTH).fill(""))
        inputRefs.current[0]?.focus()
        setLoading(false)
        submitting.current = false
      }
    },
    [failCode, formatPhone, mpcLogin, phone, refreshUser, router, selectedCountryCode]
  )

  /** Writes `digits` into the boxes starting at `start`, then focuses and submits as needed. */
  const fillCode = useCallback(
    (digits: string, start: number) => {
      if (!digits) return
      const next = [...code]
      let cursor = start
      for (const digit of digits) {
        if (cursor >= OTP_LENGTH) break
        next[cursor] = digit
        cursor += 1
      }
      setCode(next)
      setError(null)

      const joined = next.join("")
      if (joined.length === OTP_LENGTH && !next.includes("")) {
        inputRefs.current[OTP_LENGTH - 1]?.blur()
        void verifyCode(joined)
      } else {
        inputRefs.current[Math.min(cursor, OTP_LENGTH - 1)]?.focus()
      }
    },
    [code, verifyCode]
  )

  const goBackToPhone = () => {
    setStep("phone")
    setCode(new Array(OTP_LENGTH).fill(""))
    setError(null)
    setPhase("verifying")
    setLoading(false)
    submitting.current = false
  }

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-[#F9EFE5] flex items-center justify-center">
        <div className="w-9 h-9 border-[3px] border-black/15 border-t-black rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <main className="min-h-[100dvh] bg-[#F9EFE5] font-sans flex flex-col">
      {/* The rail is the only persistent chrome: it says where you are and, on the last step,
          that the wait is a step rather than a stall. Hidden on the intro, which is not yet
          part of the sequence. */}
      {step !== "intro" && (
        <header className="w-full px-6 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <div className="mx-auto w-full max-w-[380px]">
            <button
              type="button"
              onClick={step === "code" ? goBackToPhone : () => setStep("intro")}
              disabled={loading}
              className="-ml-1.5 mb-5 inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-semibold text-[#7F8790] transition-colors hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:opacity-40"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
              Back
            </button>

            <ol className="flex items-center gap-2" aria-label="Sign-in progress">
              {STEPS.map((label) => {
                const index = STEPS.indexOf(label)
                const activeIndex = STEPS.indexOf(currentStep)
                const state = index < activeIndex ? "done" : index === activeIndex ? "current" : "todo"
                return (
                  <li key={label} className="flex-1" aria-current={state === "current" || undefined}>
                    <span
                      className={`block h-[3px] rounded-full transition-colors duration-300 ${
                        state === "done"
                          ? "bg-black"
                          : state === "current"
                            ? "bg-[#F0A353]"
                            : "bg-black/10"
                      }`}
                    />
                    <span
                      className={`mt-2 block text-[11px] font-semibold tracking-wide transition-colors ${
                        state === "todo" ? "text-black/25" : "text-black/70"
                      }`}
                    >
                      {label}
                    </span>
                  </li>
                )
              })}
            </ol>
          </div>
        </header>
      )}

      <div className="flex flex-1 flex-col justify-center px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-8">
        <div className="mx-auto w-full max-w-[380px]">
          {step === "intro" && (
            <div className="animate-in fade-in duration-500">
              <div className="mb-8 flex h-44 items-center justify-start">
                <video
                  autoPlay
                  loop
                  muted
                  playsInline
                  aria-hidden
                  className="h-full w-auto object-contain mix-blend-multiply"
                >
                  <source src="/logo.webm" type="video/webm" />
                </video>
              </div>

              <h1 className="text-[34px] font-extrabold leading-[1.08] tracking-[-0.03em] text-black">
                Send money with
                <br />
                a phone number.
              </h1>
              <p className="mt-4 max-w-[34ch] text-[15px] leading-relaxed text-[#7F8790]">
                Saku sends USDC to anyone in your contacts — no wallet address to copy, no seed
                phrase to write down. Your phone number is the account.
              </p>

              <button
                onClick={() => setStep("phone")}
                className="mt-10 w-full rounded-2xl bg-black py-4 text-[15px] font-bold text-white shadow-[0_8px_24px_-8px_rgba(0,0,0,0.55)] transition-transform active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
              >
                Continue with WhatsApp
              </button>
              {/*
                This used to be two buttons, "Sign In" and "Create Account", that called the same
                handler and hit the same endpoint — there is no separate signup in Saku, the first
                verified code creates the account. Two buttons for one path is a choice the person
                has to make and cannot get right, so it is one button and a line of explanation.
              */}
              <p className="mt-4 text-center text-[13px] text-[#7F8790]">
                First time here? The same number creates your account.
              </p>
            </div>
          )}

          {step === "phone" && (
            <form
              className="animate-in fade-in slide-in-from-bottom-2 duration-300"
              onSubmit={(event) => {
                event.preventDefault()
                if (canSendCode) void requestCode(false)
              }}
            >
              <h1 className="text-[30px] font-extrabold leading-tight tracking-[-0.03em] text-black">
                What&rsquo;s your number?
              </h1>
              <p className="mt-3 max-w-[36ch] text-[15px] leading-relaxed text-[#7F8790]">
                We&rsquo;ll send a six-digit code to your WhatsApp.
              </p>

              <div className="relative mt-8">
                <CountryCodeDropdown
                  onSelect={setSelectedCountryCode}
                  selectedCode={selectedCountryCode}
                />
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  aria-label="Phone number"
                  aria-invalid={!!error}
                  value={phone}
                  autoFocus
                  onChange={(e) => {
                    setPhone(e.target.value)
                    setError(null)
                  }}
                  placeholder="812 3456 7890"
                  className="w-full rounded-2xl border-2 border-transparent bg-white py-4 pl-28 pr-4 text-lg font-bold tabular-nums shadow-[0_1px_2px_rgba(0,0,0,0.04)] outline-none transition-colors placeholder:font-semibold placeholder:text-black/20 focus:border-black"
                />
              </div>

              {/*
                Sitting against the input rather than in the heading above, because this is the
                one fact that changes what someone types and the heading is already read and
                forgotten by the time the cursor lands here. WhatsApp is the only channel Saku
                has — there is no SMS fallback — so a number without an account on it gets a
                code that can never arrive, and the failure is silent from the user's side.
              */}
              <p className="mt-2.5 flex items-start gap-1.5 px-1 text-[13px] leading-relaxed text-[#7F8790]">
                <svg
                  className="mt-[3px] h-3.5 w-3.5 shrink-0"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 004.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0012.04 2zm0 18.15h-.01a8.2 8.2 0 01-4.18-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.18 8.18 0 01-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 012.41 5.83c0 4.54-3.7 8.23-8.24 8.23z" />
                </svg>
                <span>Use a number with an active WhatsApp account. Saku never sends by SMS.</span>
              </p>

              <p role="alert" aria-live="polite" className="min-h-[1.25rem] px-1 pt-2 text-[13px] font-medium text-red-600">
                {error}
              </p>

              <button
                type="submit"
                disabled={!canSendCode}
                className="mt-4 w-full rounded-2xl bg-black py-4 text-[15px] font-bold text-white shadow-[0_8px_24px_-8px_rgba(0,0,0,0.55)] transition-transform active:scale-[0.98] disabled:opacity-25 disabled:shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
              >
                {loading ? "Sending code…" : "Send code"}
              </button>
            </form>
          )}

          {step === "code" && phase === "verifying" && (
            <form
              className="animate-in fade-in slide-in-from-bottom-2 duration-300"
              onSubmit={(event) => {
                event.preventDefault()
                void verifyCode(code.join(""))
              }}
            >
              <h1 className="text-[30px] font-extrabold leading-tight tracking-[-0.03em] text-black">
                Check WhatsApp
              </h1>
              {/* Reading the number back is the cheapest way to catch the mistake that costs the
                  most here: a code sent to a number with one wrong digit never arrives, and
                  without this the person waits for it instead of correcting it. */}
              <p className="mt-3 text-[15px] leading-relaxed text-[#7F8790]">
                We sent a six-digit code to{" "}
                <span className="font-semibold tabular-nums text-black">{displayNumber}</span>.{" "}
                <button
                  type="button"
                  onClick={goBackToPhone}
                  className="rounded font-semibold text-black underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                >
                  Not your number?
                </button>
              </p>

              <div
                className={`mt-9 flex gap-2 ${shake ? "animate-code-shake" : ""}`}
                onPaste={(event) => {
                  const pasted = event.clipboardData.getData("text").replace(/\D/g, "")
                  if (!pasted) return
                  event.preventDefault()
                  fillCode(pasted.slice(0, OTP_LENGTH), 0)
                }}
              >
                {code.map((digit, i) => (
                  <div key={i} className="relative flex-1">
                    <input
                      // `type="number"` gave these boxes spinner arrows, accepted "e" and "-",
                      // and changed the digit when the page scrolled under a hovering cursor.
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={1}
                      // Lets iOS and Android offer the code straight from the WhatsApp
                      // notification instead of making the person switch apps to read it.
                      autoComplete={i === 0 ? "one-time-code" : "off"}
                      aria-label={`Digit ${i + 1} of ${OTP_LENGTH}`}
                      aria-invalid={!!error}
                      autoFocus={i === 0}
                      disabled={loading}
                      ref={(el) => {
                        inputRefs.current[i] = el
                      }}
                      value={digit}
                      onChange={(e) => fillCode(e.target.value.replace(/\D/g, ""), i)}
                      onKeyDown={(e) => {
                        if (e.key === "Backspace") {
                          if (digit) {
                            const next = [...code]
                            next[i] = ""
                            setCode(next)
                            setError(null)
                          } else if (i > 0) {
                            inputRefs.current[i - 1]?.focus()
                          }
                          e.preventDefault()
                        }
                        if (e.key === "ArrowLeft" && i > 0) inputRefs.current[i - 1]?.focus()
                        if (e.key === "ArrowRight" && i < OTP_LENGTH - 1)
                          inputRefs.current[i + 1]?.focus()
                      }}
                      className={`peer aspect-square w-full rounded-xl bg-white text-center text-[22px] font-extrabold tabular-nums text-black shadow-[0_1px_2px_rgba(0,0,0,0.04)] outline-none transition-shadow disabled:opacity-60 ${
                        error ? "shadow-[0_0_0_2px_rgb(220,38,38)]" : ""
                      }`}
                    />
                    {/* The one loud detail on this screen: the slot you are typing into grows a
                        gold bar. Four identical boxes give no cue which one has the caret,
                        which is the whole question when you are copying digits across. */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-2.5 bottom-2 h-[3px] origin-center scale-x-0 rounded-full bg-[#F0A353] transition-transform duration-200 peer-focus:scale-x-100"
                    />
                  </div>
                ))}
              </div>

              <p role="alert" aria-live="polite" className="min-h-[1.25rem] px-1 pt-3 text-center text-[13px] font-medium text-red-600">
                {error}
              </p>

              <button
                type="submit"
                disabled={code.some((v) => !v) || loading}
                className="mt-3 w-full rounded-2xl bg-black py-4 text-[15px] font-bold text-white shadow-[0_8px_24px_-8px_rgba(0,0,0,0.55)] transition-transform active:scale-[0.98] disabled:opacity-25 disabled:shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
              >
                {loading ? "Verifying…" : "Verify"}
              </button>

              <div className="mt-5 text-center text-[13px] text-[#7F8790]">
                {secondsLeft > 0 ? (
                  <span className="tabular-nums">
                    Didn&rsquo;t get it? You can ask for a new code in {secondsLeft}s
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void requestCode(true)}
                    disabled={loading}
                    className="rounded font-semibold text-black underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:opacity-40"
                  >
                    Send a new code
                  </button>
                )}
              </div>

              {/* Every credential-phishing script for a wallet app is a stranger asking for this
                  code. Saying so on the screen where the code is live is the only place it lands. */}
              <p className="mt-8 flex items-start gap-2 rounded-xl bg-black/[0.03] px-3.5 py-3 text-[12.5px] leading-relaxed text-[#7F8790]">
                <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-black/35" strokeWidth={2} />
                <span>
                  The code expires in five minutes. Saku will never ask you for it — not by call,
                  not by chat.
                </span>
              </p>
            </form>
          )}

          {step === "code" && phase === "wallet" && (
            <div className="animate-in fade-in duration-300 text-center" role="status" aria-live="polite">
              <div className="mx-auto mb-8 h-12 w-12 rounded-full border-[3px] border-black/12 border-t-[#F0A353] motion-safe:animate-spin" />
              <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.03em] text-black">
                Setting up your wallet
              </h1>
              <p className="mx-auto mt-3 max-w-[32ch] text-[15px] leading-relaxed text-[#7F8790]">
                Creating the on-chain address your number points to. This happens once, and takes
                a few seconds.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

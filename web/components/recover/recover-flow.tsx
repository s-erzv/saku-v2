"use client"

/**
 * Recovering an account onto a new phone number.
 *
 * Written to be read by someone having a bad day: their number is gone, they cannot sign in, and
 * every screen so far has told them a code was sent somewhere they cannot reach. So it says what
 * will happen before asking for anything, and it never claims progress it has not made.
 *
 * The flow spans days and devices, so this screen is entered from three places: the start (no
 * stage), the first email's link (`awaiting_guardian` and the other outcomes), and the second
 * email's link (`choose_number`). The email links are the way back in; nothing here depends on the
 * tab staying open.
 *
 * It tells the person straight away whether the old number can be recovered and, if not, which
 * piece is missing — and if it can, which inbox to open, masked. What that discloses and why it is
 * worth it is argued in `app/api/recovery/start`. And it never says "almost done" before the
 * guardians have answered, because a screen that does is lying about the wait.
 */

import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft, Mail, Smartphone, Users } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import CountryCodeDropdown from "@/components/get-started/country-code-dropdown"
import { useAuth } from "@/hooks/useAuth"
import { useMpcWallet } from "@/hooks/useMpcWallet"
import { OTP_LENGTH } from "@/lib/otp-shape"

const SAKU_ORANGE = "#F0A353"

type StageAction = "signin" | "restart"

/** Why `/api/recovery/start` said no. Each one gets its own sentence; see the note at the top. */
type Refusal =
  | { code: "NOT_RECOVERABLE" }
  /** `active` separates "none at all" from "one, and a recovery needs two". */
  | { code: "NO_ACTIVE_GUARDIAN"; activeFrom: string | null; active: number; required: number }

/**
 * What `/api/recovery/start` answered when it did not refuse.
 *
 * `alreadyOpen` means nothing new was sent: a recovery the owner already confirmed is still
 * running, and `stage` says which of its two emails holds the next step.
 */
interface StartResult {
  maskedEmail: string
  alreadyOpen: boolean
  stage?: string
  expiresAt?: string
  progress?: { approved: number; panel: number; required: number | null } | null
}

/** Outcomes the email links redirect back with. `choose_number` is not here; it is a form. */
const STAGE_COPY: Record<
  string,
  { title: string; body: string; tone: "good" | "bad"; action?: StageAction }
> = {
  awaiting_guardian: {
    title: "Email confirmed. Now your guardians have to agree.",
    body: "We asked the guardians on your account. Once most of them confirm it is you, we will email you a second link to choose your new number. You can close this page — open the link in your email again any time to see where things stand.",
    tone: "good",
  },
  no_guardian: {
    title: "Email confirmed, but there is no guardian to ask.",
    body: "This account has no active guardian, and a backup email on its own is not enough to hand an account to a new number. There is no way to complete this recovery.",
    tone: "bad",
    action: "signin",
  },
  not_enough_guardians: {
    title: "Email confirmed, but there are not enough guardians to ask.",
    body: "Handing an account to a new number takes two guardians agreeing, and this account has one. A backup email and a single guardian are not enough. Guardians can only be added from an account that can still sign in, so there is no way to complete this recovery from here.",
    tone: "bad",
    action: "signin",
  },
  guardian_approved: {
    title: "Your guardians already confirmed it is you.",
    body: "Check your backup email for a second message with the link to choose your new number. That link works for 24 hours after the last guardian needed approved.",
    tone: "good",
  },
  done: {
    title: "This account has already been recovered.",
    body: "Sign in with the new number you chose.",
    tone: "good",
    action: "signin",
  },
  rejected: {
    title: "A guardian said this was not you.",
    body: "One guardian saying no is enough to close the request, and nothing changed on the account. If that was a mistake, talk to them first, then start again.",
    tone: "bad",
    action: "restart",
  },
  expired: {
    title: "This recovery has expired.",
    body: "A request lasts seven days, and the link to choose a new number lasts 24 hours after your guardians approve. Start again and a new link will be sent.",
    tone: "bad",
    action: "restart",
  },
  invalid: {
    title: "That link is not valid.",
    body: "It may already have been used, or a newer email replaced it. Start again to get a new one.",
    tone: "bad",
    action: "restart",
  },
  failed: {
    title: "Something went wrong.",
    body: "Nothing changed on the account. Try the link again, or start over.",
    tone: "bad",
    action: "restart",
  },
}

const STEPS = [
  { icon: Mail, text: "We email a link to the backup address saved on your account." },
  { icon: Users, text: "Most of your guardians confirm it is really you." },
  { icon: Smartphone, text: "You choose your new number and confirm it with a code. Same account, same wallet." },
]

/** In the reader's own locale and time zone, since "10:27 UTC" helps nobody decide when to retry. */
function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * "2 of your 3 guardians", from the counts the email link redirects with.
 *
 * Spelled out because the rule is a majority, and "a guardian has to agree" would send an owner
 * with three guardians to chase one and then wonder why nothing happened.
 */
function guardianProgress(params: { get(name: string): string | null }): string | null {
  const panel = Number(params.get("panel"))
  const required = Number(params.get("required"))
  const approved = Number(params.get("approved") ?? 0)
  if (!panel || !required) return null

  const who =
    panel === 1
      ? "Your guardian has"
      : required === panel
        ? `Both of your guardians have`
        : `${required} of your ${panel} guardians have`
  const soFar = approved > 0 ? ` ${approved} already ${approved === 1 ? "has" : "have"}.` : ""

  return `${who} to confirm it is you.${soFar} Once they do, we will email you a second link to choose your new number. You can close this page — open the link in your email again any time to see where things stand. Talk to them directly if you want this to go faster.`
}

function PhoneField({
  label,
  dial,
  onDial,
  value,
  onChange,
}: {
  label: string
  dial: string
  onDial: (code: string) => void
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="relative">
      <CountryCodeDropdown onSelect={onDial} selectedCode={dial} />
      <input
        type="tel"
        inputMode="tel"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="812 3456 7890"
        className="w-full rounded-2xl border border-input bg-white py-3 pl-28 pr-4 text-sm outline-none focus:border-black"
      />
    </div>
  )
}

export default function RecoverFlow() {
  const router = useRouter()
  const params = useSearchParams()
  const stage = params.get("stage")
  const stageCopy = stage ? STAGE_COPY[stage] : null
  const stageBody =
    stage === "awaiting_guardian" ? guardianProgress(params) ?? stageCopy?.body : stageCopy?.body
  const choosingNumber = stage === "choose_number"
  const confirmedCount = Number(params.get("confirmed") ?? 0)

  const { refreshUser } = useAuth()
  const { login: mpcLogin } = useMpcWallet()

  const [step, setStep] = useState<"intro" | "old">("intro")
  const [oldDial, setOldDial] = useState("+62")
  const [oldPhone, setOldPhone] = useState("")
  const [sent, setSent] = useState<StartResult | null>(null)
  const [refusal, setRefusal] = useState<Refusal | null>(null)

  const [numberStep, setNumberStep] = useState<"phone" | "code">("phone")
  const [dial, setDial] = useState("+62")
  const [phone, setPhone] = useState("")
  const [otp, setOtp] = useState("")
  const [closed, setClosed] = useState(false)
  const [finishing, setFinishing] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/recovery/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPhone, oldCountryCode: oldDial.replace("+", "") }),
      })
      const data = await response.json().catch(() => ({}))
      if (data.code === "NOT_RECOVERABLE") {
        setRefusal({ code: "NOT_RECOVERABLE" })
        return
      }
      if (data.code === "NO_ACTIVE_GUARDIAN") {
        setRefusal({
          code: "NO_ACTIVE_GUARDIAN",
          activeFrom: data.activeFrom ?? null,
          active: Number(data.active ?? 0),
          required: Number(data.required ?? 2),
        })
        return
      }
      if (!response.ok) {
        setError(data.error ?? "Could not start that recovery.")
        return
      }
      setSent({
        maskedEmail: data.maskedEmail,
        alreadyOpen: !!data.alreadyOpen,
        stage: data.stage,
        expiresAt: data.expiresAt,
        progress: data.progress ?? null,
      })
    } catch {
      setError("Could not reach Saku. Check your connection.")
    } finally {
      setBusy(false)
    }
  }

  const requestCode = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, countryCode: dial.replace("+", "") }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? "We could not send a code to that number.")
        return
      }
      setNumberStep("code")
    } catch {
      setError("Could not reach Saku. Check your connection.")
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/recovery/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, countryCode: dial.replace("+", ""), otp }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.error ?? "Could not finish the recovery.")
        if (data.code === "RECOVERY_CLOSED") setClosed(true)
        if (data.code === "NUMBER_IN_USE") {
          setOtp("")
          setNumberStep("phone")
        }
        // The code is dead rather than mistyped, so the digits go and the screen offers to send
        // another. Leaving a stale code in the box invites the one mistake the clearer message
        // exists to prevent: submitting it again unchanged.
        if (data.code === "EXPIRED_OTP" || data.code === "OTP_ATTEMPTS_EXHAUSTED") {
          setOtp("")
        }
        return
      }

      // The session arrived as a cookie on that response. Same hand-off as a normal sign-in: bring
      // the wallet up now so home opens on an address, and let home retry if this step fails.
      setFinishing(true)
      try {
        await mpcLogin()
      } catch {
        toast.error("Wallet setup didn't finish. You can pick it up again from home.")
      }
      await refreshUser()
      router.replace("/home")
    } catch {
      setError("Could not reach Saku. Check your connection.")
    } finally {
      setBusy(false)
    }
  }

  const primaryButton = "w-full h-12 rounded-2xl text-white font-semibold"
  const emphasis = "font-semibold text-foreground"

  return (
    <div className="min-h-dvh bg-[#FFFCF9] font-sans max-w-lg mx-auto">
      <header className="flex items-center gap-3 px-5 py-5">
        <Link href="/get-started" aria-label="Back" className="rounded-full p-2 hover:bg-zinc-100">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        {/* The last step shares this page with the first. Under the same title, the finish link
            read as being sent back to the start, so it says where the person actually is. */}
        <h1 className="text-lg font-bold tracking-tight">
          {choosingNumber ? "Last step: your new number" : "Recover your account"}
        </h1>
      </header>

      <main className="px-5 pb-16 space-y-4">
        {choosingNumber ? (
          <section className="rounded-[2rem] border border-border/50 bg-white p-6 space-y-4">
            <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-4">
              <Users className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <p className="text-sm leading-relaxed text-emerald-900">
                <span className="font-semibold">
                  Your email and{" "}
                  {confirmedCount === 1
                    ? "your guardian"
                    : confirmedCount > 1
                      ? `${confirmedCount} guardians`
                      : "your guardians"}{" "}
                  confirmed it is you.
                </span>{" "}
                All that is left is the number your account moves to — same balance, same wallet.
              </p>
            </div>
            {numberStep === "phone" ? (
              <>
                <h2 className="font-bold tracking-tight">Choose your new number</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Your account and wallet move to this number. We will send it a code on WhatsApp.
                </p>
                <PhoneField
                  label="Your new phone number"
                  dial={dial}
                  onDial={setDial}
                  value={phone}
                  onChange={setPhone}
                />
                {error && <p className="text-sm text-red-600 leading-relaxed">{error}</p>}
                <Button
                  disabled={busy || phone.trim().length < 6}
                  onClick={requestCode}
                  className={primaryButton}
                  style={{ backgroundColor: SAKU_ORANGE }}
                >
                  {busy ? "Sending…" : "Send code"}
                </Button>
              </>
            ) : (
              <>
                <h2 className="font-bold tracking-tight">Enter the code</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Sent to your new number on WhatsApp. Once it checks out, your account moves to this
                  number and you are signed in.
                </p>
                <Input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))}
                  placeholder={"0".repeat(OTP_LENGTH)}
                  inputMode="numeric"
                  aria-label="Verification code"
                  className="h-12 rounded-2xl tracking-[0.4em] text-center font-bold"
                />
                {error && <p className="text-sm text-red-600 leading-relaxed">{error}</p>}
                {closed ? (
                  <Link href="/recover" className="block">
                    <Button className={primaryButton} style={{ backgroundColor: SAKU_ORANGE }}>
                      Start again
                    </Button>
                  </Link>
                ) : (
                  <Button
                    disabled={busy || finishing || otp.length !== OTP_LENGTH}
                    onClick={finish}
                    className={primaryButton}
                    style={{ backgroundColor: SAKU_ORANGE }}
                  >
                    {finishing ? "Opening your wallet…" : busy ? "Finishing…" : "Finish recovery"}
                  </Button>
                )}
              </>
            )}
          </section>
        ) : stageCopy ? (
          <section
            className="rounded-[2rem] border p-6 space-y-3"
            style={{
              backgroundColor: stageCopy.tone === "good" ? "#ECFDF5" : "#FFFBEB",
              borderColor: stageCopy.tone === "good" ? "#A7F3D0" : "#FDE68A",
            }}
          >
            <h2 className="font-bold tracking-tight leading-snug">{stageCopy.title}</h2>
            <p className="text-sm leading-relaxed text-zinc-700">{stageBody}</p>
            {stageCopy.action && (
              <Link href={stageCopy.action === "signin" ? "/get-started" : "/recover"} className="block">
                <Button className="w-full h-12 rounded-2xl text-white" style={{ backgroundColor: SAKU_ORANGE }}>
                  {stageCopy.action === "signin" ? "Go to sign in" : "Start again"}
                </Button>
              </Link>
            )}
          </section>
        ) : sent ? (
          <section className="rounded-[2rem] border border-border/50 bg-white p-6 space-y-3">
            <div className="rounded-2xl bg-emerald-50 p-2.5 w-fit">
              <Mail className="h-5 w-5 text-emerald-600" />
            </div>
            {sent.alreadyOpen && sent.stage === "choose_number" ? (
              <>
                <h2 className="font-bold tracking-tight leading-snug">
                  Your guardians already confirmed it is you.
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  All that is left is choosing your new number. Open the second email we sent to{" "}
                  <span className={emphasis}>{sent.maskedEmail}</span> — titled “Your guardians
                  confirmed it is you” — and tap its link.
                </p>
                {sent.expiresAt && (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    That link works until <span className={emphasis}>{formatMoment(sent.expiresAt)}</span>.
                    Nothing new was sent just now, and a new recovery can only start after that.
                  </p>
                )}
              </>
            ) : sent.alreadyOpen && sent.stage === "awaiting_guardian" ? (
              <>
                <h2 className="font-bold tracking-tight leading-snug">
                  Your recovery is waiting on your guardians.
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {sent.progress?.required
                    ? `${sent.progress.approved} of the ${sent.progress.required} confirmations needed are in. `
                    : ""}
                  Nothing new was sent — open the first email we sent to{" "}
                  <span className={emphasis}>{sent.maskedEmail}</span> any time to see where things
                  stand. Once enough guardians confirm, a second email arrives with the link to choose
                  your new number.
                </p>
                {sent.expiresAt && (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    This request stays open until{" "}
                    <span className={emphasis}>{formatMoment(sent.expiresAt)}</span>. A new one can
                    only start after that.
                  </p>
                )}
              </>
            ) : sent.alreadyOpen ? (
              <>
                <h2 className="font-bold tracking-tight leading-snug">
                  You already have a recovery in progress.
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  We sent the link to <span className={emphasis}>{sent.maskedEmail}</span> earlier.
                  Open it to see where things stand — there is no need to start again.
                </p>
              </>
            ) : (
              <>
                <h2 className="font-bold tracking-tight leading-snug">Check your backup email.</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  We sent a recovery link to <span className={emphasis}>{sent.maskedEmail}</span>. Not
                  there after a minute? Check your spam folder.
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Open the link in that email. Then most of your guardians have to confirm it is you,
                  and we will email you a second link to choose your new number. You can close this
                  page in between.
                </p>
              </>
            )}
          </section>
        ) : refusal ? (
          <section className="rounded-[2rem] border border-[#FDE68A] bg-[#FFFBEB] p-6 space-y-3">
            {refusal.code === "NO_ACTIVE_GUARDIAN" && refusal.active > 0 ? (
              <>
                <h2 className="font-bold tracking-tight leading-snug">
                  This account needs {refusal.required} guardians, and has {refusal.active}.
                </h2>
                <p className="text-sm leading-relaxed text-zinc-700">
                  A recovery hands the account to a new number, so {refusal.required} guardians have to
                  agree — one on their own is not enough.
                </p>
                {refusal.activeFrom ? (
                  <p className="text-sm leading-relaxed text-zinc-700">
                    Another guardian accepted recently and can help from{" "}
                    <span className="font-semibold">{formatMoment(refusal.activeFrom)}</span>. Try again
                    after that.
                  </p>
                ) : (
                  <p className="text-sm leading-relaxed text-zinc-700">
                    Guardians can only be added from an account you can still sign in to, so this
                    number cannot be recovered.
                  </p>
                )}
              </>
            ) : refusal.code === "NO_ACTIVE_GUARDIAN" && refusal.activeFrom ? (
              <>
                <h2 className="font-bold tracking-tight leading-snug">
                  Your guardians aren&apos;t ready yet.
                </h2>
                <p className="text-sm leading-relaxed text-zinc-700">
                  Your backup email is set, but a guardian can only confirm a recovery 24 hours after
                  accepting. Yours can help from{" "}
                  <span className="font-semibold">{formatMoment(refusal.activeFrom)}</span>. Try again
                  after that.
                </p>
              </>
            ) : refusal.code === "NO_ACTIVE_GUARDIAN" ? (
              <>
                <h2 className="font-bold tracking-tight leading-snug">
                  There is no guardian to confirm it is you.
                </h2>
                <p className="text-sm leading-relaxed text-zinc-700">
                  This account has a backup email but no guardian, and a backup email on its own is not
                  enough to move an account to a new number.
                </p>
              </>
            ) : (
              <>
                <h2 className="font-bold tracking-tight leading-snug">
                  Sorry, this number can&apos;t be recovered.
                </h2>
                <p className="text-sm leading-relaxed text-zinc-700">
                  Recovery only works if the account had a backup email and two active guardians set
                  up before the number was lost.
                </p>
                <p className="text-sm leading-relaxed text-zinc-700">
                  Check that you typed the old number correctly — it has to be the number the account
                  was registered with.
                </p>
              </>
            )}
            <Button
              onClick={() => setRefusal(null)}
              className={primaryButton}
              style={{ backgroundColor: SAKU_ORANGE }}
            >
              {refusal.code === "NOT_RECOVERABLE" ? "Try another number" : "Back"}
            </Button>
            <Link href="/get-started" className="block">
              <Button variant="ghost" className="w-full h-12 rounded-2xl">
                Back to sign in
              </Button>
            </Link>
          </section>
        ) : step === "intro" ? (
          <section className="rounded-[2rem] border border-border/50 bg-white p-6 space-y-5">
            <h2 className="text-xl font-bold tracking-tight leading-snug">
              Lost the number you signed up with?
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              You can move your account and wallet to a new number, but only if you added a backup
              email and guardians before you lost it. It takes three steps.
            </p>

            <ul className="space-y-3">
              {STEPS.map((item) => (
                <li key={item.text} className="flex items-start gap-3">
                  <div className="rounded-xl bg-zinc-100 p-2 shrink-0">
                    <item.icon className="h-4 w-4 text-zinc-500" />
                  </div>
                  <p className="text-sm leading-relaxed pt-1.5">{item.text}</p>
                </li>
              ))}
            </ul>

            <p className="text-sm text-muted-foreground leading-relaxed">
              You can close this page between steps. Each email has a link that brings you back to
              where you left off.
            </p>

            <Button
              onClick={() => setStep("old")}
              className={primaryButton}
              style={{ backgroundColor: SAKU_ORANGE }}
            >
              Start
            </Button>
          </section>
        ) : (
          <section className="rounded-[2rem] border border-border/50 bg-white p-6 space-y-4">
            <h2 className="font-bold tracking-tight">What was your old number?</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The number your Saku account is registered to. We will send the recovery link to the
              backup email saved on that account.
            </p>
            <PhoneField
              label="Your old phone number"
              dial={oldDial}
              onDial={setOldDial}
              value={oldPhone}
              onChange={setOldPhone}
            />
            {error && <p className="text-sm text-red-600 leading-relaxed">{error}</p>}
            <Button
              disabled={busy || oldPhone.trim().length < 6}
              onClick={start}
              className={primaryButton}
              style={{ backgroundColor: SAKU_ORANGE }}
            >
              {busy ? "Checking…" : "Send recovery link"}
            </Button>
          </section>
        )}
      </main>
    </div>
  )
}

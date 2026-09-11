"use client"

/**
 * Setting up account recovery, as a screen of its own at `/security/setup`.
 *
 * It has been through two shapes before this one. A bottom sheet first, on the theory that a
 * sheet over a usable Home reads as a reminder rather than a gate — but a backup email and a few
 * guardians is real setup, and a sheet scrolling inside itself made the most consequential choice
 * in the app feel like a toast. Then a full-screen overlay, which looked right and still behaved
 * like a popup: no URL, nothing for the Back button to understand, and no way to link someone to
 * it from anywhere else.
 *
 * So it is a route. The look is the onboarding tour's — full screen, one idea per step, progress
 * along the top — and the one property the sheet existed for survives: "Not now" is on every step,
 * and it snoozes rather than nags (see `lib/recovery-snooze.ts`).
 *
 * Steps move on buttons, not swipes. Two of them have inputs, and a horizontal swipe fights with
 * selecting text and scrolling a contact list.
 *
 * Which steps appear is decided once, on mount, from what the account already has. Confirming an
 * email mid-flow must not make the email step vanish from under the person reading it.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ArrowLeft, ArrowRight, Check, Clock, Mail, UserPlus, Users } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth, type RecoveryStatus } from "@/hooks/useAuth"
import CountryCodeDropdown from "@/components/get-started/country-code-dropdown"
import countryCodes from "@/lib/country-codes.json"
import { snooze } from "@/lib/recovery-snooze"

const SAKU_ORANGE = "#F0A353"

type Step = "why" | "email" | "guardians" | "done"
/** The steps that ask for something, and so are the ones worth numbering. */
type SetupStep = Extract<Step, "email" | "guardians">

/**
 * The dialling code has to be asked for, not assumed.
 *
 * A number is hashed as `country + national digits`, so inviting a Malaysian number while the
 * form quietly assumes Indonesia produces a hash for a number nobody has, and the invitation
 * comes back as "not on Saku yet" for someone who is plainly on Saku. Defaults to the inviter's
 * own country, which is the right guess almost every time without being invisible.
 */
function dialCodeFor(iso: string | undefined): string {
  const match = (countryCodes as Array<{ dial_code: string; code: string }>).find(
    (c) => c.code === iso
  )
  return match?.dial_code ?? "+62"
}

/** Contacts already resolved to a Saku account — the only ones invitable by id. */
interface PickableContact {
  id: string
  label: string
  onSaku: boolean
}

/** The same test `recovery-gate.tsx` routes here on, so a step is shown exactly when it is missing. */
function stepsFor(recovery: RecoveryStatus): Step[] {
  const steps: Step[] = ["why"]
  if (!recovery.emailVerified) steps.push("email")
  if (recovery.activeGuardians + recovery.pendingGuardians === 0) steps.push("guardians")
  steps.push("done")
  return steps
}

function StepHeading({ accent, title, body }: { accent: string; title: string; body: string }) {
  return (
    <div className="space-y-4">
      <span className="text-[10px] font-black uppercase tracking-[0.3em]" style={{ color: SAKU_ORANGE }}>
        {accent}
      </span>
      <h2 id="recovery-setup-title" className="text-4xl font-bold tracking-tighter text-zinc-900 leading-[1.05]">
        {title.split("\n").map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </h2>
      <p className="text-zinc-500 text-base font-light leading-relaxed">{body}</p>
    </div>
  )
}

function SummaryRow({ icon: Icon, done, text }: { icon: typeof Check; done: boolean; text: string }) {
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-zinc-100 bg-white p-4">
      <div className={`rounded-xl p-2 shrink-0 ${done ? "bg-emerald-50" : "bg-amber-50"}`}>
        <Icon className={`h-4 w-4 ${done ? "text-emerald-600" : "text-amber-600"}`} />
      </div>
      <p className="text-sm leading-relaxed text-zinc-700 pt-1">{text}</p>
    </li>
  )
}

export default function RecoverySetup() {
  const router = useRouter()
  const { user, recovery, refreshUser } = useAuth()
  const reduceMotion = useReducedMotion()

  const [steps] = useState(() => stepsFor(recovery))
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState(1)
  const step = steps[index]

  const [emailDraft, setEmailDraft] = useState("")
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null)
  const [emailConfigured, setEmailConfigured] = useState(true)

  const [contacts, setContacts] = useState<PickableContact[] | null>(null)
  const [existingGuardians, setExistingGuardians] = useState(0)
  const [limit, setLimit] = useState(3)
  const [invited, setInvited] = useState<Array<{ key: string; name: string }>>([])
  const [enteringNumber, setEnteringNumber] = useState(false)
  const [manualName, setManualName] = useState("")
  const [manualPhone, setManualPhone] = useState("")
  const [manualDial, setManualDial] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // What the account already has, loaded once up front so no step waits on a spinner when it opens.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch("/api/account/email").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/guardians").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/contacts").then((r) => (r.ok ? r.json() : { contacts: [] })).catch(() => ({ contacts: [] })),
    ]).then(([email, guardians, contactData]) => {
      if (cancelled) return
      if (email) {
        setEmailConfigured(email.configured !== false)
        // A link already on its way counts as sent. Asking again would only replace it.
        if (email.pending) setEmailSentTo(email.pending)
      }
      if (guardians) {
        setExistingGuardians((guardians.guardians ?? []).length)
        setLimit(guardians.limit ?? 3)
      }
      setContacts((contactData.contacts ?? []).filter((c: PickableContact) => c.onSaku))
    })
    return () => {
      cancelled = true
    }
  }, [])

  const go = (delta: number) => {
    setError(null)
    setDirection(delta)
    setIndex((i) => Math.min(Math.max(i + delta, 0), steps.length - 1))
  }

  /** Every way out lands on Home — this screen is reached from there, and from Profile. */
  const leave = () => router.push("/home")

  /** "Not now" on any step. Quiet for a week rather than forever; see `lib/recovery-snooze.ts`. */
  const dismiss = () => {
    snooze()
    leave()
  }

  const finish = () => {
    void refreshUser()
    leave()
  }

  const sendEmailLink = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/account/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailDraft.trim() }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.error ?? "Could not send that link.")
        return
      }
      setEmailSentTo(data.to ?? emailDraft.trim())
      setEmailDraft("")
    } catch {
      setError("Could not reach Saku. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  const invite = async (body: Record<string, string>, name: string, key: string) => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/guardians", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.error ?? "Could not send that invitation.")
        // A contact Saku only knows by a hash of their number cannot be messaged, so the answer
        // is to ask for the number — not to leave someone reading an error with nothing to do
        // about it. Opening the form here is the difference between a dead end and a next step.
        if (data.code === "NEEDS_NUMBER") setEnteringNumber(true)
        return false
      }
      setInvited((list) => [...list, { key, name }])
      return true
    } catch {
      setError("Could not reach Saku. Check your connection and try again.")
      return false
    } finally {
      setBusy(false)
    }
  }

  const dialCode = manualDial ?? dialCodeFor(user?.country_code)
  const guardianTotal = existingGuardians + invited.length
  const atLimit = guardianTotal >= limit
  // "Step 1 of 2" only counts the steps that ask for something — `why` and `done` are reading,
  // not work, and numbering them makes a one-minute setup look like four.
  const setupSteps = steps.filter((s): s is SetupStep => s === "email" || s === "guardians")
  const stepLabel = (s: SetupStep) =>
    setupSteps.length > 1 ? `Step ${setupSteps.indexOf(s) + 1} of ${setupSteps.length}` : "One step"

  const variants = {
    enter: (dir: number) => ({ opacity: 0, x: reduceMotion ? 0 : dir * 32 }),
    center: { opacity: 1, x: 0 },
    exit: (dir: number) => ({ opacity: 0, x: reduceMotion ? 0 : dir * -32 }),
  }

  const invitedNames = invited.map((i) => i.name)
  const namesText =
    invitedNames.length <= 1
      ? invitedNames.join("")
      : `${invitedNames.slice(0, -1).join(", ")} & ${invitedNames[invitedNames.length - 1]}`

  const emailInPlace = recovery.emailVerified || !!emailSentTo
  const allInPlace = emailInPlace && guardianTotal > 0

  const primaryClass =
    "flex-1 h-[60px] rounded-2xl text-white hover:opacity-90 transition-all group flex items-center justify-between px-7 text-lg font-bold shadow-xl shadow-[#F0A353]/25 disabled:opacity-40 disabled:shadow-none"

  const content = (() => {
    switch (step) {
      case "why":
        return (
          <div className="space-y-8">
            <StepHeading
              accent="Account recovery"
              title={"Your number is\nyour only key."}
              body="Saku signs you in with a code sent to your phone. If that number is lost, blocked, or handed to someone else by your carrier, there is currently no way back into this account — or the money in it."
            />
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <div className="rounded-xl bg-white border border-zinc-100 p-2.5 shrink-0">
                  <Mail className="h-4 w-4" style={{ color: SAKU_ORANGE }} />
                </div>
                <p className="text-sm leading-relaxed text-zinc-600 pt-1.5">
                  <span className="font-semibold text-zinc-900">A backup email.</span> Every recovery
                  starts with a link sent to it.
                </p>
              </li>
              <li className="flex items-start gap-3">
                <div className="rounded-xl bg-white border border-zinc-100 p-2.5 shrink-0">
                  <Users className="h-4 w-4" style={{ color: SAKU_ORANGE }} />
                </div>
                <p className="text-sm leading-relaxed text-zinc-600 pt-1.5">
                  <span className="font-semibold text-zinc-900">Guardians.</span> People you trust
                  confirm it is really you — more than half of them have to agree.
                </p>
              </li>
            </ul>
            <p className="text-sm text-zinc-400">You need both. It takes about a minute.</p>
          </div>
        )

      case "email":
        return (
          <div className="space-y-8">
            <StepHeading
              accent={stepLabel("email")}
              title={"Where should\nrecovery start?"}
              body="If you ever lose your number, the first link goes here. Use an address you will still have in a year."
            />
            {emailSentTo ? (
              <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-4">
                <Mail className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                <p className="text-sm leading-relaxed text-emerald-900">
                  <span className="font-semibold">Check {emailSentTo}.</span> Tap the link we sent — it
                  works for an hour. You can keep going while you wait.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <Input
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  placeholder="you@example.com"
                  inputMode="email"
                  autoComplete="email"
                  aria-label="Backup email"
                  className="h-14 rounded-2xl text-base bg-white"
                />
                {!emailConfigured && (
                  <p className="text-sm text-amber-700">
                    Email sending is not set up on this deployment yet, so no link would arrive.
                  </p>
                )}
              </div>
            )}
          </div>
        )

      case "guardians":
        return (
          <div className="space-y-6">
            <StepHeading
              accent={stepLabel("guardians")}
              title={"Who would vouch\nfor you?"}
              body="Pick people who know you well. When you recover, more than half of them must confirm it is you — so with three, one can be unreachable."
            />

            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">
                Your guardians
              </p>
              <p className="text-xs font-bold tabular-nums" style={{ color: SAKU_ORANGE }}>
                {guardianTotal} / {limit}
              </p>
            </div>

            {contacts === null ? (
              <p className="text-sm text-zinc-400">Loading your contacts…</p>
            ) : enteringNumber || contacts.length === 0 ? (
              <div className="space-y-3">
                {contacts.length === 0 && (
                  <p className="text-sm text-zinc-500 leading-relaxed">
                    None of your saved contacts are on Saku yet. Add someone by their name and number.
                  </p>
                )}
                <Input
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="Their name"
                  aria-label="Their name"
                  className="h-14 rounded-2xl text-base bg-white"
                />
                <div className="relative">
                  <CountryCodeDropdown onSelect={setManualDial} selectedCode={dialCode} />
                  <input
                    type="tel"
                    inputMode="tel"
                    aria-label="Their phone number"
                    value={manualPhone}
                    onChange={(e) => setManualPhone(e.target.value)}
                    placeholder="812 3456 7890"
                    className="w-full h-14 rounded-2xl border border-input bg-white pl-28 pr-4 text-base outline-none transition-colors placeholder:text-black/25 focus:border-black"
                  />
                </div>
                <Button
                  variant="outline"
                  disabled={busy || atLimit || !manualName.trim() || !manualPhone.trim()}
                  onClick={async () => {
                    const name = manualName.trim()
                    const ok = await invite(
                      { label: name, phone: manualPhone.trim(), countryCode: dialCode.replace("+", "") },
                      name,
                      `manual-${dialCode}${manualPhone.trim()}`
                    )
                    if (ok) {
                      setManualName("")
                      setManualPhone("")
                    }
                  }}
                  className="w-full h-12 rounded-2xl bg-white"
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  {busy ? "Sending…" : "Send invitation"}
                </Button>
                {contacts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setEnteringNumber(false)}
                    className="w-full text-sm font-semibold text-zinc-500 py-2"
                  >
                    Choose from contacts instead
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {contacts.map((contact) => {
                  const done = invited.some((i) => i.key === contact.id)
                  return (
                    <div
                      key={contact.id}
                      className="flex items-center gap-3 rounded-2xl border border-zinc-100 bg-white p-3 pl-4"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{contact.label}</span>
                      {done ? (
                        <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 px-3 py-2">
                          <Check className="h-3.5 w-3.5" /> Invited
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          disabled={busy || atLimit}
                          onClick={() => invite({ contactId: contact.id }, contact.label, contact.id)}
                          className="rounded-xl text-white shrink-0"
                          style={{ backgroundColor: SAKU_ORANGE }}
                        >
                          Invite
                        </Button>
                      )}
                    </div>
                  )
                })}
                <button
                  type="button"
                  onClick={() => setEnteringNumber(true)}
                  className="w-full text-sm font-semibold text-zinc-500 py-3"
                >
                  Someone not in this list? Enter their number
                </button>
              </div>
            )}

            {invited.length > 0 && (
              <p className="text-sm text-zinc-500 leading-relaxed">
                Invitation sent to {namesText}. They decide whether to accept, and can help 24 hours
                after they do.
              </p>
            )}
          </div>
        )

      case "done":
        return (
          <div className="space-y-8">
            <StepHeading
              accent={allInPlace ? "All set" : "Almost there"}
              title={allInPlace ? "You have a\nway back." : "Almost\nthere."}
              body={
                allInPlace
                  ? "Once everything below is done, losing this number no longer means losing this account."
                  : "Recovery needs both pieces. Anything missing can be finished any time from Account security."
              }
            />
            <ul className="space-y-3">
              {recovery.emailVerified ? (
                <SummaryRow icon={Check} done text="Backup email confirmed." />
              ) : emailSentTo ? (
                <SummaryRow
                  icon={Clock}
                  done={false}
                  text={`Open the link we sent to ${emailSentTo}. The email counts once you do.`}
                />
              ) : (
                <SummaryRow
                  icon={Mail}
                  done={false}
                  text="No backup email yet. Every recovery starts there."
                />
              )}

              {recovery.activeGuardians > 0 && invited.length === 0 ? (
                <SummaryRow
                  icon={Check}
                  done
                  text={`${recovery.activeGuardians} active ${recovery.activeGuardians === 1 ? "guardian" : "guardians"}.`}
                />
              ) : invited.length > 0 ? (
                <SummaryRow
                  icon={Clock}
                  done={false}
                  text={`Waiting for ${namesText} to accept. Each can help 24 hours after they do.`}
                />
              ) : guardianTotal > 0 ? (
                <SummaryRow
                  icon={Clock}
                  done={false}
                  text="Your guardians still have to accept, then wait 24 hours before they can help."
                />
              ) : (
                <SummaryRow
                  icon={UserPlus}
                  done={false}
                  text="No guardians yet. A backup email alone cannot recover this account."
                />
              )}
            </ul>
          </div>
        )
    }
  })()

  const primary = (() => {
    switch (step) {
      case "why":
        return { label: "Set it up", onClick: () => go(1), disabled: false }
      case "email":
        return emailSentTo
          ? { label: "Next", onClick: () => go(1), disabled: false }
          : {
              label: busy ? "Sending…" : "Send link",
              onClick: sendEmailLink,
              disabled: busy || !emailConfigured || !emailDraft.includes("@"),
            }
      case "guardians":
        return { label: guardianTotal > 0 ? "Next" : "Skip for now", onClick: () => go(1), disabled: busy }
      case "done":
        return { label: "Done", onClick: finish, disabled: false }
    }
  })()

  return (
    // `h-dvh` rather than `min-h-dvh`, unlike the other screens: the step area scrolls inside
    // itself so the progress bar and the primary button stay where they were on the step before.
    // A wizard whose button walks down the page as steps get longer is a wizard people lose.
    <div className="h-dvh bg-white font-sans flex justify-center">
      <motion.main
        initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.25, ease: "easeOut" }}
        aria-labelledby="recovery-setup-title"
        className="w-full max-w-lg h-full flex flex-col relative overflow-hidden bg-[#FFFCF9] border-x border-zinc-100/50 shadow-sm"
      >
        <div
          className="absolute top-[-10%] right-[-10%] w-[80%] aspect-square rounded-full blur-[120px] opacity-20 pointer-events-none"
          style={{ backgroundColor: SAKU_ORANGE }}
        />

        <div className="relative z-20 flex items-center gap-4 px-6 pt-8 pb-2">
          <div className="flex flex-1 gap-1.5">
            {steps.map((s, i) => (
              <div key={s} className="h-[4px] flex-grow bg-zinc-200/60 rounded-full overflow-hidden">
                <motion.div
                  initial={false}
                  animate={{ width: index >= i ? "100%" : "0%" }}
                  className="h-full rounded-full"
                  style={{ backgroundColor: SAKU_ORANGE }}
                  transition={{ duration: reduceMotion ? 0 : 0.5, ease: "easeInOut" }}
                />
              </div>
            ))}
          </div>
          {step !== "done" && (
            <button
              type="button"
              onClick={dismiss}
              className="text-sm font-semibold text-zinc-400 hover:text-zinc-700 transition-colors"
            >
              Not now
            </button>
          )}
        </div>

        <div className="relative z-10 flex-1 min-h-0 overflow-y-auto px-8 pt-12 pb-6">
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={step}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: reduceMotion ? 0 : 0.25, ease: "easeOut" }}
            >
              {content}
            </motion.div>
          </AnimatePresence>
          {error && <p className="mt-6 text-sm text-red-600 leading-relaxed">{error}</p>}
        </div>

        <div className="shrink-0 w-full p-6 bg-white/95 backdrop-blur-md border-t border-zinc-100 relative z-20 space-y-3">
          <div className="flex gap-3">
            {index > 0 && (
              <Button
                variant="outline"
                onClick={() => go(-1)}
                aria-label="Back"
                className="h-[60px] w-[60px] rounded-2xl shrink-0 bg-white"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            )}
            <Button
              onClick={primary.onClick}
              disabled={primary.disabled}
              style={{ backgroundColor: SAKU_ORANGE }}
              className={primaryClass}
            >
              <span>{primary.label}</span>
              <ArrowRight className="w-6 h-6 stroke-[3px] group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
          {step === "email" && !emailSentTo && (
            <button
              type="button"
              onClick={() => go(1)}
              className="w-full text-sm font-semibold text-zinc-400 hover:text-zinc-700 transition-colors py-1"
            >
              Skip for now
            </button>
          )}
          {step === "done" && (
            <button
              type="button"
              onClick={() => {
                void refreshUser()
                router.push("/profile/security")
              }}
              className="w-full text-sm font-semibold text-zinc-400 hover:text-zinc-700 transition-colors py-1"
            >
              Open Account security
            </button>
          )}
        </div>
      </motion.main>
    </div>
  )
}

"use client"

/**
 * Account security: the backup email, the guardians, and one honest sentence about whether this
 * account can be recovered at all.
 *
 * The status line at the top is the point of the screen. Everything below it is machinery for
 * changing that one answer, and the answer is computed from the same rule the recovery flow
 * uses, so the badge cannot say "protected" while a real recovery would refuse.
 */

import { useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft, Check, Clock, Mail, ShieldAlert, ShieldCheck, Trash2, UserPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/hooks/useAuth"
import CountryCodeDropdown from "@/components/get-started/country-code-dropdown"
import countryCodes from "@/lib/country-codes.json"

const SAKU_ORANGE = "#F0A353"

/** Same picker as sign-up, so there is one country list in the app rather than two orderings. */
function dialCodeFor(iso: string | undefined): string {
  const match = (countryCodes as Array<{ dial_code: string; code: string }>).find(
    (c) => c.code === iso
  )
  return match?.dial_code ?? "+62"
}

interface Guardian {
  id: string
  label: string
  state: "awaiting_response" | "cooling_down" | "active" | "revoked"
  cooldownMs: number
}

/**
 * `requestedBy` is this user's own contact label for the person when `inContacts` is true, and
 * otherwise only what that account calls itself — which anyone can set to anything. The screen
 * says which, because that is the difference between a name to trust and a name to check.
 */
interface Invitation {
  id: string
  requestedBy: string
  inContacts: boolean
}

interface RecoveryAsk {
  id: string
  requestedBy: string
  inContacts: boolean
}

/** Contacts already resolved to a Saku account — the only ones invitable by id. */
interface PickableContact {
  id: string
  label: string
  onSaku: boolean
}

interface EmailState {
  email: string | null
  verified: boolean
  pending: string | null
  configured: boolean
}

const LINK_OUTCOME_COPY: Record<string, string> = {
  verified: "Backup email confirmed.",
  expired: "That link expired. Send a new one.",
  invalid: "That link is not valid.",
  failed: "Something went wrong confirming that address.",
}

function hoursLeft(ms: number): string {
  const hours = Math.ceil(ms / (60 * 60 * 1000))
  return hours <= 1 ? "under an hour" : `${hours} hours`
}

/** What a guardian is told after approving, which depends on whether theirs was the deciding vote. */
function approvalNotice(data: Record<string, unknown>): string {
  if (data.completed) {
    return "Approved. That was the last confirmation needed — we emailed them a link to choose their new number."
  }
  return `Approved. ${String(data.approvals)} of ${String(data.required)} guardians have confirmed so far. They get their link once enough have.`
}

export default function AccountSecurity() {
  const router = useRouter()
  const params = useSearchParams()
  const { user, refreshUser } = useAuth()

  const [guardians, setGuardians] = useState<Guardian[] | null>(null)
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [recoveries, setRecoveries] = useState<RecoveryAsk[]>([])
  const [limit, setLimit] = useState(3)
  const [email, setEmail] = useState<EmailState | null>(null)

  const [emailDraft, setEmailDraft] = useState("")
  const [addingEmail, setAddingEmail] = useState(false)
  const [guardianName, setGuardianName] = useState("")
  const [guardianPhone, setGuardianPhone] = useState("")
  // Derived, not stored, until the user actually picks one. Holding it in state and syncing it
  // from an effect meant re-rendering the whole screen once just to move a select that was
  // already computable at render.
  const [guardianDialChoice, setGuardianDialChoice] = useState<string | null>(null)
  const [addingGuardian, setAddingGuardian] = useState(false)
  const [contacts, setContacts] = useState<PickableContact[] | null>(null)
  const [enteringNumber, setEnteringNumber] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [g, e] = await Promise.all([
      fetch("/api/guardians").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/account/email").then((r) => (r.ok ? r.json() : null)),
    ])
    if (g) {
      setGuardians(g.guardians ?? [])
      setInvitations(g.invitations ?? [])
      setRecoveries(g.recoveries ?? [])
      setLimit(g.limit ?? 3)
    } else {
      setGuardians([])
    }
    if (e) setEmail(e)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Loaded the first time the add form opens, not with the screen: most visits never add anyone.
  // Picking from contacts comes first because it is the common case — the people someone trusts
  // are usually already people they pay — and because it sends an id rather than a number that
  // could be mistyped into a stranger's.
  useEffect(() => {
    if (!addingGuardian || contacts !== null) return

    let cancelled = false
    fetch("/api/contacts")
      .then((r) => (r.ok ? r.json() : { contacts: [] }))
      .then((data) => {
        if (cancelled) return
        setContacts((data.contacts ?? []).filter((c: PickableContact) => c.onSaku))
      })
      .catch(() => {
        if (!cancelled) setContacts([])
      })

    return () => {
      cancelled = true
    }
  }, [addingGuardian, contacts])

  // The verification link lands back here with its outcome in the query string, because the
  // person clicking it is in a mail client and has to be told somewhere what happened. Read
  // straight out of the URL at render — it is already a value, and copying it into state would
  // only create a second version of it that can disagree.
  const linkOutcome = params.get("email")
  const linkNotice = linkOutcome ? LINK_OUTCOME_COPY[linkOutcome] ?? null : null

  const call = async (
    fn: () => Promise<Response>,
    success: string | ((data: Record<string, unknown>) => string)
  ) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fn()
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.error ?? "That did not work.")
        // A contact Saku only knows by a hash of their number cannot be messaged, so the answer
        // is to ask for the number rather than leave someone reading an error with nothing to do
        // about it. Opening the form here is the difference between a dead end and a next step.
        if (data.code === "NEEDS_NUMBER") setEnteringNumber(true)
        return false
      }
      setNotice(typeof success === "function" ? success(data) : success)
      await Promise.all([load(), refreshUser()])
      return true
    } catch {
      setError("Could not reach Saku. Check your connection.")
      return false
    } finally {
      setBusy(false)
    }
  }

  const closeGuardianForm = () => {
    setGuardianName("")
    setGuardianPhone("")
    setEnteringNumber(false)
    setAddingGuardian(false)
  }

  const inviteGuardian = async (body: Record<string, string>, name: string) => {
    const ok = await call(
      () =>
        fetch("/api/guardians", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      `Invitation sent to ${name}. They decide whether to accept.`
    )
    if (ok) closeGuardianForm()
  }

  const guardianDial = guardianDialChoice ?? dialCodeFor(user?.country_code)

  const activeGuardians = (guardians ?? []).filter((g) => g.state === "active").length
  const coolingMs = (guardians ?? []).filter((g) => g.state === "cooling_down").map((g) => g.cooldownMs)
  const emailVerified = email?.verified ?? false
  // "On" means a recovery would work today: a confirmed email AND an active guardian, the same
  // test the recovery screen applies. Either one alone used to read "Recovery is on", and the
  // owner found out otherwise at the one moment they could no longer fix it.
  const recoveryReady = emailVerified && activeGuardians > 0
  const status = recoveryReady
    ? {
        title: "Recovery is on",
        body: "If you lose this phone number, you can prove the account is yours and move it to a new one.",
      }
    : !emailVerified && (guardians ?? []).length === 0
      ? {
          title: "Recovery is off",
          body: "Your phone number is the only way into this account. If it is lost, blocked, or reassigned by your carrier, there is no way to get back in.",
        }
      : {
          title: "Recovery is not ready yet",
          body: !emailVerified
            ? "Add a backup email. Every recovery starts with a link sent to it, so guardians alone cannot recover this account."
            : coolingMs.length > 0
              ? `Your guardian can help in ${hoursLeft(Math.min(...coolingMs))}. Until then, a recovery would be refused.`
              : "Add a guardian. A backup email on its own cannot move this account to a new number.",
        }
  const atLimit = (guardians ?? []).length >= limit
  const showManualForm = enteringNumber || (contacts !== null && contacts.length === 0)

  return (
    <div className="min-h-dvh bg-[#FFFCF9] font-sans max-w-lg mx-auto">
      <header className="flex items-center gap-3 px-5 py-5">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="rounded-full p-2 hover:bg-zinc-100"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold tracking-tight">Account security</h1>
      </header>

      <main className="px-5 pb-16 space-y-4">
        <section
          className="rounded-[2rem] border p-6 space-y-2"
          style={{
            backgroundColor: recoveryReady ? "#ECFDF5" : "#FFFBEB",
            borderColor: recoveryReady ? "#A7F3D0" : "#FDE68A",
          }}
        >
          <div className="flex items-center gap-2">
            {recoveryReady ? (
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
            ) : (
              <ShieldAlert className="h-5 w-5 text-amber-600" />
            )}
            <h2 className="font-bold tracking-tight">{status.title}</h2>
          </div>
          <p className="text-sm leading-relaxed text-zinc-700">{status.body}</p>
        </section>

        {(notice ?? linkNotice) && (
          <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {notice ?? linkNotice}
          </p>
        )}
        {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        {recoveries.length > 0 && (
          <section className="rounded-[2rem] border border-amber-300 bg-amber-50 p-6 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-700" />
              <h2 className="font-bold tracking-tight">Someone needs you to confirm</h2>
            </div>
            <p className="text-sm text-amber-900/80 leading-relaxed">
              They say they lost their phone number and want their account moved to a new one.
              Only approve if you have spoken to them and are sure it is really them. If you say it
              is not them, the request is closed straight away.
            </p>
            {recoveries.map((ask) => (
              <div key={ask.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm truncate font-medium">{ask.requestedBy}</p>
                  {!ask.inContacts && (
                    <p className="text-xs text-amber-900/70 leading-snug">
                      Not in your contacts. This is only the name their account uses.
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      call(
                        () =>
                          fetch(`/api/recovery/${ask.id}/approve`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ accept: true }),
                          }),
                        approvalNotice
                      )
                    }
                    className="rounded-xl bg-amber-600 text-white hover:bg-amber-700"
                  >
                    This is them
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      call(
                        () =>
                          fetch(`/api/recovery/${ask.id}/approve`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ accept: false }),
                          }),
                        "Rejected. The request is closed and nothing changed on their account."
                      )
                    }
                    className="rounded-xl"
                  >
                    Not them
                  </Button>
                </div>
              </div>
            ))}
          </section>
        )}

        {invitations.length > 0 && (
          <section className="rounded-[2rem] border border-border/50 bg-white p-6 space-y-3">
            <h2 className="font-bold tracking-tight">People asking for your help</h2>
            {invitations.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between gap-3">
                <div className="text-sm min-w-0">
                  <p>
                    <span className="font-medium">{invite.requestedBy}</span> wants you as a guardian.
                  </p>
                  {!invite.inContacts && (
                    <p className="text-xs text-muted-foreground leading-snug">
                      Not in your contacts. Only accept if you know who this is.
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      call(
                        () =>
                          fetch(`/api/guardians/${invite.id}/approve`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ accept: true }),
                          }),
                        "You are now their guardian."
                      )
                    }
                    className="rounded-xl text-white"
                    style={{ backgroundColor: SAKU_ORANGE }}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      call(
                        () =>
                          fetch(`/api/guardians/${invite.id}/approve`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ accept: false }),
                          }),
                        "Declined."
                      )
                    }
                    className="rounded-xl"
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="rounded-[2rem] border border-border/50 bg-white p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-zinc-100 p-2.5">
              <Mail className="h-5 w-5 text-zinc-500" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-bold tracking-tight">Backup email</h2>
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                {email?.verified
                  ? `Confirmed as ${email.email}.`
                  : email?.pending
                    ? `Waiting for you to open the link sent to ${email.pending}.`
                    : "Used to start a recovery if you lose your number."}
              </p>
            </div>
          </div>

          {email && !email.configured && (
            <p className="text-sm text-amber-700">
              Email sending is not configured on this deployment yet, so no message will arrive.
            </p>
          )}

          {email?.verified ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => call(() => fetch("/api/account/email", { method: "DELETE" }), "Backup email removed.")}
              className="w-full h-11 rounded-2xl text-red-600 hover:text-red-700"
            >
              Remove this email
            </Button>
          ) : addingEmail ? (
            <div className="space-y-2">
              <Input
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                placeholder="you@example.com"
                inputMode="email"
                autoComplete="email"
                className="h-12 rounded-2xl"
              />
              <Button
                disabled={busy || !emailDraft.trim()}
                onClick={async () => {
                  const ok = await call(
                    () =>
                      fetch("/api/account/email", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ email: emailDraft.trim() }),
                      }),
                    "Check that inbox for a confirmation link."
                  )
                  if (ok) {
                    setEmailDraft("")
                    setAddingEmail(false)
                  }
                }}
                className="w-full h-11 rounded-2xl text-white font-semibold"
                style={{ backgroundColor: SAKU_ORANGE }}
              >
                Send confirmation link
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={() => setAddingEmail(true)}
              className="w-full h-11 rounded-2xl"
            >
              {email?.pending ? "Use a different address" : "Add an email"}
            </Button>
          )}
        </section>

        <section className="rounded-[2rem] border border-border/50 bg-white p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-zinc-100 p-2.5">
              <UserPlus className="h-5 w-5 text-zinc-500" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-bold tracking-tight">Guardians</h2>
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                People you trust who can confirm a recovery is really you. Up to {limit}. A recovery
                needs more than half of them to agree, so with three, one can be unreachable.
              </p>
            </div>
          </div>

          {guardians === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : guardians.length === 0 ? (
            <p className="text-sm text-muted-foreground">No guardians yet.</p>
          ) : (
            <ul className="space-y-2">
              {guardians.map((guardian) => (
                <li
                  key={guardian.id}
                  className="flex items-center gap-3 rounded-2xl border border-border/50 p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{guardian.label}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      {guardian.state === "active" ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-600" /> Active
                        </>
                      ) : guardian.state === "cooling_down" ? (
                        <>
                          <Clock className="h-3 w-3" /> Active in {hoursLeft(guardian.cooldownMs)}
                        </>
                      ) : (
                        <>
                          <Clock className="h-3 w-3" /> Waiting for them to accept
                        </>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Remove ${guardian.label}`}
                    onClick={() =>
                      call(
                        () => fetch(`/api/guardians/${guardian.id}`, { method: "DELETE" }),
                        `${guardian.label} is no longer a guardian.`
                      )
                    }
                    className="rounded-xl p-2 text-zinc-400 hover:text-red-600 shrink-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {addingGuardian ? (
            contacts === null ? (
              <p className="text-sm text-muted-foreground">Loading your contacts…</p>
            ) : showManualForm ? (
              <div className="space-y-2">
                {contacts.length === 0 && (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    None of your saved contacts are on Saku yet. Add a guardian by their name and
                    number.
                  </p>
                )}
                <Input
                  value={guardianName}
                  onChange={(e) => setGuardianName(e.target.value)}
                  placeholder="Their name"
                  className="h-12 rounded-2xl"
                />
                <div className="relative">
                  <CountryCodeDropdown onSelect={setGuardianDialChoice} selectedCode={guardianDial} />
                  <input
                    type="tel"
                    inputMode="tel"
                    aria-label="Their phone number"
                    value={guardianPhone}
                    onChange={(e) => setGuardianPhone(e.target.value)}
                    placeholder="812 3456 7890"
                    className="w-full rounded-2xl border border-input bg-white py-3 pl-28 pr-4 text-sm outline-none transition-colors placeholder:text-black/25 focus:border-black"
                  />
                </div>
                <Button
                  disabled={busy || !guardianName.trim() || !guardianPhone.trim()}
                  onClick={() =>
                    inviteGuardian(
                      {
                        label: guardianName.trim(),
                        phone: guardianPhone.trim(),
                        countryCode: guardianDial.replace("+", ""),
                      },
                      guardianName.trim()
                    )
                  }
                  className="w-full h-11 rounded-2xl text-white font-semibold"
                  style={{ backgroundColor: SAKU_ORANGE }}
                >
                  Send invitation
                </Button>
                <Button
                  variant="ghost"
                  onClick={contacts.length > 0 ? () => setEnteringNumber(false) : closeGuardianForm}
                  className="w-full h-11 rounded-2xl text-muted-foreground"
                >
                  {contacts.length > 0 ? "Choose from contacts instead" : "Cancel"}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Choose from your contacts on Saku.</p>
                <ul className="space-y-2">
                  {contacts.map((contact) => (
                    <li
                      key={contact.id}
                      className="flex items-center gap-3 rounded-2xl border border-border/50 p-3 pl-4"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{contact.label}</span>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => inviteGuardian({ contactId: contact.id }, contact.label)}
                        className="rounded-xl text-white shrink-0"
                        style={{ backgroundColor: SAKU_ORANGE }}
                      >
                        Invite
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button
                  variant="outline"
                  onClick={() => setEnteringNumber(true)}
                  className="w-full h-11 rounded-2xl"
                >
                  Enter a name and number instead
                </Button>
                <Button
                  variant="ghost"
                  onClick={closeGuardianForm}
                  className="w-full h-11 rounded-2xl text-muted-foreground"
                >
                  Cancel
                </Button>
              </div>
            )
          ) : (
            <Button
              variant="outline"
              disabled={atLimit}
              onClick={() => setAddingGuardian(true)}
              className="w-full h-11 rounded-2xl"
            >
              {atLimit ? `You have all ${limit} guardians` : "Add a guardian"}
            </Button>
          )}
        </section>
      </main>
    </div>
  )
}

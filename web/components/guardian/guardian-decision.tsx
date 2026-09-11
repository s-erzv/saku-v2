"use client"

/**
 * The screen a guardian lands on from WhatsApp.
 *
 * Both guardian links — "will you be a guardian?" and "is this really them?" — end here. They
 * ask different questions with different stakes, but the person reading is in the same unusual
 * position either way: they have no Saku account, no session, and quite possibly no idea what
 * Saku is. The page has to explain itself from nothing, in the seconds before someone decides
 * whether a message from an unknown number is worth trusting.
 *
 * So it is deliberately plain. No app chrome, no navigation, nothing to tap but the two answers.
 * There is nowhere else to go from here and pretending otherwise would only invite someone to
 * wander off mid-decision.
 *
 * Declining is a real answer, not a way out, and it is given the same weight as agreeing. The
 * failure this guards against is a guardian who approves because approving was the only obvious
 * button — which is exactly the failure a majority vote is supposed to prevent.
 */

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { AlertTriangle, Check, Loader2, ShieldCheck, X } from "lucide-react"

const SAKU_ORANGE = "#F0A353"

export interface DecisionCopy {
  /** Small caps line above the heading. */
  accent: string
  heading: (subject: string) => string
  body: (subject: string) => string
  /** The one thing they should do before answering, if there is one. */
  caution?: string
  points: string[]
  confirmLabel: string
  declineLabel: string
  confirmedTitle: string
  confirmedBody: string
  declinedTitle: string
  declinedBody: string
}

interface GuardianDecisionProps {
  /** Endpoint that both describes the request (GET) and records the answer (POST). */
  endpoint: string
  copy: DecisionCopy
  /** Pulls the name to address this person about out of the GET payload. */
  subjectOf: (data: Record<string, unknown>) => string
}

type Phase =
  | { name: "loading" }
  | { name: "dead"; message: string }
  | { name: "ready"; subject: string }
  | { name: "sending"; subject: string }
  | { name: "answered"; accepted: boolean }

export default function GuardianDecision({ endpoint, copy, subjectOf }: GuardianDecisionProps) {
  const [phase, setPhase] = useState<Phase>({ name: "loading" })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    fetch(endpoint)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setPhase({ name: "dead", message: data.error ?? "This link is no longer open." })
          return
        }
        setPhase({ name: "ready", subject: subjectOf(data) })
      })
      .catch(() => {
        if (!cancelled) {
          setPhase({ name: "dead", message: "Could not reach Saku. Check your connection." })
        }
      })

    return () => {
      cancelled = true
    }
  }, [endpoint, subjectOf])

  const answer = async (accept: boolean) => {
    if (phase.name !== "ready") return
    setPhase({ name: "sending", subject: phase.subject })
    setError(null)

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error ?? "Could not record that answer.")
        setPhase({ name: "ready", subject: phase.subject })
        return
      }
      setPhase({ name: "answered", accepted: accept })
    } catch {
      setError("Could not reach Saku. Check your connection and try again.")
      setPhase({ name: "ready", subject: phase.subject })
    }
  }

  return (
    <div className="min-h-dvh bg-white font-sans flex justify-center">
      <main className="w-full max-w-lg min-h-dvh relative overflow-hidden bg-[#FFFCF9] border-x border-zinc-100/50 px-7 py-12 flex flex-col">
        <div
          className="absolute top-[-10%] right-[-10%] w-[80%] aspect-square rounded-full blur-[120px] opacity-20 pointer-events-none"
          style={{ backgroundColor: SAKU_ORANGE }}
        />

        <div className="relative z-10 flex-1 flex flex-col">
          <span
            className="text-[10px] font-black uppercase tracking-[0.3em]"
            style={{ color: SAKU_ORANGE }}
          >
            {phase.name === "dead" ? "Saku" : copy.accent}
          </span>

          {phase.name === "loading" && (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-300" />
            </div>
          )}

          {phase.name === "dead" && (
            <Outcome
              tone="neutral"
              title="This link is closed"
              body={phase.message}
            />
          )}

          {phase.name === "answered" && (
            <Outcome
              tone={phase.accepted ? "good" : "neutral"}
              title={phase.accepted ? copy.confirmedTitle : copy.declinedTitle}
              body={phase.accepted ? copy.confirmedBody : copy.declinedBody}
            />
          )}

          {(phase.name === "ready" || phase.name === "sending") && (
            <>
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="mt-4 space-y-5"
              >
                <h1 className="text-4xl font-bold tracking-tighter text-zinc-900 leading-[1.05]">
                  {copy.heading(phase.subject)}
                </h1>
                <p className="text-zinc-500 text-base font-light leading-relaxed">
                  {copy.body(phase.subject)}
                </p>

                {copy.caution && (
                  <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4">
                    <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
                    <p className="text-sm leading-relaxed text-amber-900">{copy.caution}</p>
                  </div>
                )}

                <ul className="space-y-3 pt-1">
                  {copy.points.map((point) => (
                    <li key={point} className="flex items-start gap-3">
                      <div className="rounded-xl bg-white border border-zinc-100 p-2 shrink-0">
                        <ShieldCheck className="h-4 w-4" style={{ color: SAKU_ORANGE }} />
                      </div>
                      <p className="text-sm leading-relaxed text-zinc-600 pt-1.5">{point}</p>
                    </li>
                  ))}
                </ul>
              </motion.div>

              {error && <p className="mt-6 text-sm text-red-600 leading-relaxed">{error}</p>}

              <div className="mt-auto pt-10 space-y-3">
                <button
                  type="button"
                  disabled={phase.name === "sending"}
                  onClick={() => answer(true)}
                  style={{ backgroundColor: SAKU_ORANGE }}
                  className="w-full h-[60px] rounded-2xl text-white text-lg font-bold shadow-xl shadow-[#F0A353]/25 disabled:opacity-40 disabled:shadow-none flex items-center justify-center gap-2"
                >
                  {phase.name === "sending" ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Check className="h-5 w-5 stroke-[3px]" />
                  )}
                  {copy.confirmLabel}
                </button>

                {/* Same size and same reach as agreeing. A decline that looks like a cancel link
                    turns "I am not sure" into "I will just tap the big one". */}
                <button
                  type="button"
                  disabled={phase.name === "sending"}
                  onClick={() => answer(false)}
                  className="w-full h-[60px] rounded-2xl border border-zinc-200 bg-white text-zinc-700 text-base font-bold disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  <X className="h-5 w-5" />
                  {copy.declineLabel}
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

function Outcome({ tone, title, body }: { tone: "good" | "neutral"; title: string; body: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex-1 flex flex-col justify-center space-y-4"
    >
      <div
        className={`rounded-2xl p-3 w-fit ${tone === "good" ? "bg-emerald-50" : "bg-zinc-100"}`}
      >
        {tone === "good" ? (
          <Check className="h-6 w-6 text-emerald-600 stroke-[3px]" />
        ) : (
          <ShieldCheck className="h-6 w-6 text-zinc-500" />
        )}
      </div>
      <h1 className="text-3xl font-bold tracking-tighter text-zinc-900 leading-[1.1]">{title}</h1>
      <p className="text-zinc-500 text-base font-light leading-relaxed">{body}</p>
      <p className="text-sm text-zinc-400 pt-2">You can close this page.</p>
    </motion.div>
  )
}

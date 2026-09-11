"use client"

/**
 * "Is this really them?" — the page a guardian answers a live recovery on.
 *
 * The consequential one. Saying yes moves an account, and the money in it, to a phone number
 * somebody else is holding. The one instruction that actually prevents the attack this guards
 * against is "speak to them first", so that is the only thing on screen styled as a warning —
 * a page where everything shouts is a page where nothing is heard.
 */

import { use } from "react"

import GuardianDecision from "@/components/guardian/guardian-decision"

export default function GuardianApprovePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = use(params)

  return (
    <GuardianDecision
      endpoint={`/api/recovery/approve/${token}`}
      subjectOf={(data) => String(data.owner ?? "Someone you agreed to help")}
      copy={{
        accent: "Account recovery",
        heading: (who) => `Is this really ${who}?`,
        body: (who) =>
          `${who} says they lost their phone number and wants their Saku account moved to a new one. You agreed to be one of the people who confirms that.`,
        caution:
          "Call them, or speak to them in person, before you answer. Someone pretending to be them would send you exactly this message. If you cannot reach them, wait — nothing is lost by taking your time.",
        points: [
          "Only confirm if you have spoken to them and you are sure.",
          "More than half of their guardians must agree before anything moves.",
          "If you say it is not them, the request is closed straight away.",
        ],
        confirmLabel: "I spoke to them, it's really them",
        declineLabel: "This is not them",
        confirmedTitle: "Confirmed.",
        confirmedBody:
          "Thank you. If enough of their guardians agree, they will be emailed the last step. Nothing else is needed from you.",
        declinedTitle: "Request closed.",
        declinedBody:
          "The recovery has been stopped and their account was not moved. If you think someone was impersonating them, tell them directly.",
      }}
    />
  )
}

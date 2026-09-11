"use client"

/**
 * "Will you be a guardian?" — the page the invitation link opens.
 *
 * Written for someone who may never have heard of Saku. It names what they are agreeing to in
 * terms of the obligation rather than the feature, because "be a guardian" means nothing and
 * "you confirm it is really them if they lose their phone" means something.
 */

import { use } from "react"

import GuardianDecision from "@/components/guardian/guardian-decision"

export default function GuardianInvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = use(params)

  return (
    <GuardianDecision
      endpoint={`/api/guardians/invite/${token}`}
      subjectOf={(data) => String(data.inviter ?? "A Saku user")}
      copy={{
        accent: "Guardian invitation",
        heading: (who) => `${who} asked you to look out for their account.`,
        body: (who) =>
          `Saku is a wallet that signs people in with their phone number. If ${who} ever loses that number, you are one of the people who confirms it is really them — that is the whole job.`,
        points: [
          "You do not need a Saku account, and this costs you nothing.",
          "You can never spend their money or see their balance. The only thing you can do is confirm who they are.",
          "More than half of their guardians have to agree, so you are never deciding alone.",
          "You can be removed at any time, and you can say no now without anything happening.",
        ],
        confirmLabel: "Yes, I'll help",
        declineLabel: "No thanks",
        confirmedTitle: "You're their guardian.",
        confirmedBody:
          "There is nothing to do until they need you. If that day comes, we will message you on this number — and you should speak to them before confirming anything. For safety, this only takes effect 24 hours from now.",
        declinedTitle: "Declined.",
        declinedBody:
          "Nothing was set up and they have been told. If this message was not meant for you, you can ignore it safely.",
      }}
    />
  )
}

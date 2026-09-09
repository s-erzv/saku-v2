"use client"

/**
 * The tour, on purpose rather than on first run.
 *
 * This route used to carry its own 174-line copy of the slider: the same three slides, the same
 * markup, the same copy, duplicated from `components/home/onboarding-slider.tsx`. Two copies of
 * the same screen drift — one gets a slide added, the other does not, and nobody notices because
 * only one of them was ever reachable. It renders the real component now, forced open, so there
 * is exactly one place the tour's content lives.
 */

import { useRouter } from "next/navigation"
import OnboardingSlider from "@/components/home/onboarding-slider"

export default function OnboardingPage() {
  const router = useRouter()

  // Forced, because someone arriving here asked to see it — the first-run gate would otherwise
  // render nothing for anyone who has already been through it, which is everyone who can reach
  // this route deliberately.
  return <OnboardingSlider force onClose={() => router.push("/home")} />
}

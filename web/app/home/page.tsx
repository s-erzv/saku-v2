"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/useAuth"
import HomeHeader from "@/components/home/header"
import BalanceCardSection from "@/components/home/balance-card-section"
import QuickActions from "@/components/home/quick-actions"
import RecentTransactions from "@/components/home/recent-transactions"
import BottomNavigation from "@/components/home/bottom-navigation"
import WalletSetup from "@/components/home/wallet-setup"
import WaitingPackets from "@/components/home/waiting-packets"
import BillsToPay from "@/components/home/bills-to-pay"
import GuardianRequests from "@/components/home/guardian-requests"
import OnboardingSlider from "@/components/home/onboarding-slider"
import RecoveryGate from "@/components/home/recovery-gate"

export default function HomePage() {
  const router = useRouter()
  const { user, isLoading, isAuthenticated } = useAuth()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/get-started")
  }, [isLoading, isAuthenticated, router])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center font-sans">
        <video className="w-50" src="/logo.webm" autoPlay muted loop playsInline />
      </div>
    )
  }

  if (!user || !isAuthenticated) return null

  return (
    <div className="min-h-dvh bg-white font-sans relative max-w-lg mx-auto">
      {/* Renders nothing except on the first visit after signing up — it reads the flags
          `get-started` sets and gates itself. */}
      <OnboardingSlider />

      {/* Renders nothing. Waits for the tour above to finish, then sends anyone without a way
          back to `/security/setup` — once a week at most, and never once recovery is in place. */}
      <RecoveryGate />

      <HomeHeader />

      <main className="max-w-lg mx-auto px-4 space-y-6 py-2 relative z-10">
        <BalanceCardSection />

        {/* Only renders while the wallet is still being derived, or if that failed. Once the
            MPC login lands it returns null and stays out of the way. */}
        <WalletSetup />

        {/* Above the quick actions, unlike the cards below: someone else's account is waiting on
            this answer. Renders nothing unless a guardian request is actually open. */}
        <GuardianRequests />

        <QuickActions />

        {/* Renders nothing unless a packet is actually addressed to this number — a private
            packet has no link to arrive by, so this is the only place its recipient meets it. */}
        <WaitingPackets />

        {/* Same reasoning as WaitingPackets: a bill is addressed to your number and arrives with
            no link, so it has to be findable without going looking. Renders nothing when
            everything is settled. */}
        <BillsToPay />

        <RecentTransactions />
      </main>

      <BottomNavigation />
    </div>
  )
}

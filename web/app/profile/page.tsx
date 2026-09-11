"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { User, Users } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import ProfileIdentityCard from "@/components/profile/profile-identity-card"
import AccountDetails from "@/components/profile/account-details"
import WalletSecurity from "@/components/profile/wallet-security"
import { AccountRecoveryBanner, AccountRecoveryRow } from "@/components/profile/account-recovery-link"
import PushNotifications from "@/components/profile/push-notifications"
import SettingsGroup from "@/components/profile/settings-group"
import ContactsList from "@/components/profile/contacts-list"
import HomeHeader from "@/components/home/header"
import BottomNavigation from "@/components/home/bottom-navigation"

export default function ProfilePage() {
  const router = useRouter()
  const { isLoading, isAuthenticated } = useAuth()
  const [activeTab, setActiveTab] = useState<'profile' | 'contacts'>('profile')

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/get-started")
    }
  }, [isLoading, isAuthenticated, router])

  // The same wordmark Home waits behind, rather than a bare spinner on a different background.
  // Two loading screens for one app is the kind of seam people read as a bug.
  if (isLoading) return (
    <div className="min-h-screen bg-white flex items-center justify-center font-sans">
      <video className="w-50" src="/logo.webm" autoPlay muted loop playsInline />
    </div>
  )

  if (!isAuthenticated) return null

  const tabs = [
    { id: 'profile' as const, label: 'My Saku', icon: User },
    { id: 'contacts' as const, label: 'Contacts', icon: Users },
  ]

  return (
    <div className="min-h-dvh bg-white font-sans text-foreground max-w-lg mx-auto">
      <HomeHeader />

      <main className="max-w-lg mx-auto px-4 space-y-6 pb-28">

        {/* A segmented control on a hairline, not a filled tray. The selected tab used to be
            `text-primary`, which is Saku's yellow — legible on the dark balance card it was
            borrowed from and close to invisible on white. It is ink on white here, and the
            unselected one is the one that recedes. */}
        <div
          role="tablist"
          aria-label="Profile sections"
          className="flex gap-1 p-1 rounded-2xl border border-black/[0.08] bg-black/[0.02]"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon
            const selected = activeTab === tab.id
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                  selected
                    ? 'bg-white text-slate-900 border border-black/[0.06]'
                    : 'text-black/45 hover:text-black/70'
                }`}
              >
                <Icon className="w-4 h-4" /> {tab.label}
              </button>
            )
          })}
        </div>

        {activeTab === 'profile' ? (
          /* Four bands, in the order someone actually needs them.
             
             Who this is, then anything that is wrong, then the account's own facts, then the
             settings that have a state. This screen used to be five cards of identical weight in
             a column, so "your account cannot be recovered" looked exactly like "notification
             sounds" and neither could be read without scrolling past the other. Grouping the
             settings into two cards of rows is most of what fixed the length; putting the state
             on the right of every row is what removed the reason to tap into them at all. */
          <div className="space-y-5 animate-in slide-in-from-bottom-2 duration-300">
            <ProfileIdentityCard />

            {/* Renders nothing at all unless a recovery factor is missing. When it does render it
                is the most consequential thing on the screen — everything below it is a
                preference, and this one decides whether the account survives losing a phone
                number — so it sits above them and looks unlike them. */}
            <AccountRecoveryBanner />

            <AccountDetails />

            <SettingsGroup title="Security">
              <AccountRecoveryRow />
              {/* Renders nothing until the signing provider reports a connected wallet. */}
              <WalletSecurity />
            </SettingsGroup>

            <SettingsGroup title="Preferences">
              <PushNotifications />
            </SettingsGroup>

            {/* Signing out lives in the header's account menu, which is on every screen. A
                second copy here, commented out behind a "Danger Zone" heading, was dead code
                pretending to be a feature. */}
          </div>
        ) : (
          <div className="animate-in slide-in-from-bottom-2 duration-300 pb-4">
            <ContactsList />
          </div>
        )}
      </main>
      
      <BottomNavigation />
    </div>
  )
}
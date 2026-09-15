"use client"

/**
 * Profile, in the web wallet.
 *
 * The app splits this screen into two tabs because a phone has room for one column. A desktop has
 * room for both, so the account sits on the left and the address book on the right, and nothing
 * is one tap away that could simply be on screen.
 *
 * Every piece is the app's own component. The web layout decides only where they go.
 */

import ProfileIdentityCard from "@/components/profile/profile-identity-card"
import AccountDetails from "@/components/profile/account-details"
import WalletSecurity from "@/components/profile/wallet-security"
import { AccountRecoveryBanner, AccountRecoveryRow } from "@/components/profile/account-recovery-link"
import PushNotifications from "@/components/profile/push-notifications"
import SettingsGroup from "@/components/profile/settings-group"
import ContactsList from "@/components/profile/contacts-list"

export default function WebProfile() {
  return (
    <div className="@container mx-auto w-full max-w-[1240px] px-4 py-6 font-sans sm:px-6 lg:px-8 lg:py-8">
      <h1 className="text-[28px] font-semibold tracking-tight">Profile</h1>

      <div className="mt-6 grid items-start gap-6 @4xl:grid-cols-2 @4xl:gap-8">
        <div className="space-y-5">
          <ProfileIdentityCard />
          <AccountRecoveryBanner />
          <AccountDetails />
          <SettingsGroup title="Security">
            <AccountRecoveryRow />
            <WalletSecurity />
          </SettingsGroup>
          <SettingsGroup title="Preferences">
            <PushNotifications />
          </SettingsGroup>
        </div>

        <section>
          <h2 className="px-1 mb-2 text-[13px] font-medium text-black/50">Contacts</h2>
          <ContactsList />
        </section>
      </div>
    </div>
  )
}

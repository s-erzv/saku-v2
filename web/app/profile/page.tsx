"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { LogOut, User, Users, Settings } from "lucide-react"
import { useAuth } from "@/hooks/useAuth" 
import ProfileCard from "@/components/profile/profile-card"
import WalletSecurity from "@/components/profile/wallet-security"
import PushNotifications from "@/components/profile/push-notifications"
import ContactsList from "@/components/profile/contacts-list"
import HomeHeader from "@/components/home/header"
import BottomNavigation from "@/components/home/bottom-navigation"

export default function ProfilePage() {
  const router = useRouter()
  const { isLoading, logout, isAuthenticated } = useAuth()
  const [activeTab, setActiveTab] = useState<'profile' | 'contacts'>('profile')

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/get-started")
    }
  }, [isLoading, isAuthenticated, router])

  if (isLoading) return (
    <div className="min-h-screen bg-[#F9EFE5] flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
    </div>
  )

  if (!isAuthenticated) return null

  return (
    <div className="min-h-dvh bg-[#FDFCFB] text-foreground">
      <HomeHeader />

      <main className="max-w-lg mx-auto px-5 space-y-6">
        
        <div className="flex p-1 bg-muted/20 rounded-2xl border border-border/50">
          <button 
            onClick={() => setActiveTab('profile')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all ${
              activeTab === 'profile' ? 'bg-white shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <User className="w-4 h-4" /> My Saku
          </button>
          <button 
            onClick={() => setActiveTab('contacts')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all ${
              activeTab === 'contacts' ? 'bg-white shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Users className="w-4 h-4" /> Contacts
          </button>
        </div>

        {activeTab === 'profile' ? (
          <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-300">
            <ProfileCard />
            <PushNotifications />
            <WalletSecurity />
            
            {/* <div className="space-y-4 pt-4">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground px-1">Danger Zone</h3>
              <button
                onClick={() => logout()}
                className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl bg-red-50 text-red-600 font-bold transition-all border border-red-100 active:scale-[0.98]"
              >
                <LogOut className="w-5 h-5" />
                Sign Out
              </button>
            </div> */}
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
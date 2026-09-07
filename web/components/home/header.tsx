"use client"

import { useState } from "react"
import { LogOut } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"

/**
 * v1 fetched the profile row itself with the anon key and showed the user's phone number.
 * Neither survives v2: the browser has no read path to `users`, and there is no phone number to
 * show. The greeting falls back to the last four characters of the phone hash — stable per
 * user, recognisable across sessions, and not personal data.
 */
export default function HomeHeader() {
  const { user, logout } = useAuth()
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)

  const label = user?.display_name?.trim() || (user ? `Saku ${user.phone_hash.slice(-4)}` : "Saku User")
  const initials = user?.display_name?.trim()
    ? user.display_name.split(" ").filter(Boolean).map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : (user?.phone_hash.slice(-2).toUpperCase() ?? "S")

  return (
    <header className="relative z-50 px-5 sm:px-6 pt-8 pb-4 max-w-lg mx-auto font-sans">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="relative shrink-0">
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="group relative flex items-center justify-center transition-transform active:scale-95"
            >
              <div className="relative w-12 h-12 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center">
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center text-white font-bold text-sm">
                    {initials}
                  </div>
                )}
              </div>
            </button>

            {isDropdownOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setIsDropdownOpen(false)} />
                <div className="absolute left-0 mt-3 w-56 bg-white/90 backdrop-blur-2xl border rounded-xl shadow-lg p-2 z-20 animate-in fade-in zoom-in-95 duration-150 origin-top-left">
                  <div className="px-3 py-2 border-b border-gray-200/80 mb-1">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Account</p>
                    <p className="text-sm font-semibold text-gray-800 truncate">{label}</p>
                  </div>
                  <button
                    onClick={() => { setIsDropdownOpen(false); logout(); }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-all"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="flex flex-col min-w-0 justify-center">
            <p className="text-sm font-medium text-gray-500 leading-tight mb-0.5">Welcome,</p>
            <p className="text-xl font-bold text-slate-900 truncate tracking-tight leading-tight">{label}</p>
          </div>
        </div>
      </div>
    </header>
  )
}

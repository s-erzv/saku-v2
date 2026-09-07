"use client"

/**
 * v1 loaded this card from a `profiles` table with the anon key. That table does not exist in
 * v2 — identity lives on `users`/`wallets`, and every table is RLS-on with no permissive policy
 * — so every query here used to 404 silently and the card always rendered its empty state
 * ("Not generated yet") even for a user who already had a wallet. It now reads the same
 * `user`/`wallet` that `/api/me` already resolved for `useAuth`, and saves through
 * `/api/profile/update` instead of writing a table the browser has no path to.
 */

import { useState } from "react"
import { Copy, CheckCircle, Loader2, Smartphone, User, Wallet, Edit2, Save, X } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { toast } from "sonner"

export default function ProfileCard() {
  const { user, wallet, token, refreshUser } = useAuth()
  const [isUpdating, setIsUpdating] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [fullName, setFullName] = useState(user?.display_name || "")

  const handleUpdateProfile = async () => {
    if (!token) return
    const displayName = fullName.trim()
    if (!displayName) return toast.error("Name cannot be empty")

    setIsUpdating(true)
    try {
      const res = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ displayName }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed')

      await refreshUser()
      setIsEditing(false)
      toast.success("Profile updated")
    } catch {
      toast.error("Could not update profile")
    } finally {
      setIsUpdating(false)
    }
  }

  const copy = (text: string | null | undefined, field: string) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const displayName = user?.display_name || 'Saku User'
  const walletAddress = wallet?.address || null

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="relative aspect-[1.6/1] w-full rounded-[2.5rem] p-8 text-white overflow-hidden shadow-2xl transition-all duration-500 hover:shadow-amber-500/20 border border-white/10 group">
        <div className="absolute inset-0 bg-[#0A0A0A]" />

        <div className="absolute inset-0 opacity-40">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,#f59e0b20,transparent_70%)]" />
          <div className="absolute inset-0 bg-gradient-to-tr from-amber-900/20 via-transparent to-orange-500/10 animate-pulse" />
        </div>

        <div className="absolute inset-0 opacity-30 group-hover:opacity-50 transition-opacity duration-700">
          <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] brightness-100 contrast-150 mix-blend-soft-light"></div>
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -skew-x-12 translate-x-[-150%] group-hover:translate-x-[150%] transition-transform duration-[1500ms] ease-in-out" />
        </div>

        <div className="absolute -top-24 -right-24 w-64 h-64 bg-amber-500/10 blur-[100px] rounded-full" />
        <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-orange-600/10 blur-[100px] rounded-full" />

        <div className="relative h-full flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-white/5 rounded-lg backdrop-blur-sm border border-white/10">
                  <img src="/logo.png" alt="" className="w-8 h-8 object-contain" />
                </div>
                <span className="font-bold tracking-tight text-lg bg-gradient-to-br from-white to-white/60 bg-clip-text text-transparent">
                  Saku.
                </span>
              </div>

              <div className="w-11 h-8 bg-gradient-to-br from-amber-200 via-amber-400 to-amber-600 rounded-md relative shadow-[0_0_15px_rgba(251,191,36,0.3)] overflow-hidden">
                <div className="absolute inset-0 grid grid-cols-2 gap-px opacity-30">
                  <div className="border-r border-b border-black/50" />
                  <div className="border-b border-black/50" />
                  <div className="border-r border-black/50" />
                </div>
                <div className="absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent"></div>
              </div>
            </div>

            <div className="relative group/avatar">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-2xl border border-white/20 overflow-hidden flex items-center justify-center shadow-2xl transition-all duration-300 group-hover:border-amber-500/50">
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-8 h-8 opacity-20" />
                )}
              </div>
              {/* No storage bucket wired up for avatars yet — showing an upload control here
                  would just fail every time it's used, so it stays a read-only display until
                  that backend exists. */}
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-0.5">
              <p className="text-[10px] font-semibold text-amber-500 tracking-[0.2em]">Member Name</p>
              <p className="text-2xl font-semibold tracking-tight truncate leading-tight drop-shadow-sm">
                {displayName}
              </p>
            </div>

            <div className="flex justify-between items-end">
              <div className="space-y-1">
                <p className="text-[10px] text-white/30 font-medium tracking-[0.15em]">Wallet Address</p>
                <div className="px-3 py-1 bg-white/5 rounded-lg border border-white/5 backdrop-blur-md">
                  <p className="text-sm font-mono tracking-[0.1em] text-amber-100/90">
                    {walletAddress
                      ? `${walletAddress.slice(0, 4)} •••• •••• ${walletAddress.slice(-4)}`
                      : 'Not generated yet'}
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-end">
                <div className="px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
                  <p className="text-[9px] font-semibold tracking-tighter text-amber-500">
                    {walletAddress ? 'Verified' : 'Pending'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-card rounded-[2rem] border border-border/50 p-6 shadow-sm space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-muted-foreground tracking-tight">Personal Details</h3>
          {!isEditing ? (
            <button
              onClick={() => { setFullName(user?.display_name || ""); setIsEditing(true) }}
              className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 hover:bg-amber-50 px-3 py-1.5 rounded-full transition-colors"
            >
              <Edit2 className="w-3 h-3" /> Edit Profile
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setIsEditing(false)}
                className="p-1.5 text-muted-foreground hover:bg-muted rounded-full transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
              <button
                onClick={handleUpdateProfile}
                disabled={isUpdating}
                className="flex items-center gap-1.5 text-xs font-semibold bg-amber-500 text-black px-4 py-1.5 rounded-full shadow-sm disabled:opacity-50"
              >
                {isUpdating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save
              </button>
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-muted-foreground tracking-wider ml-1">Full Name</label>
            <div className={`flex items-center gap-3 p-4 rounded-2xl border transition-all ${isEditing ? 'border-amber-500/50 bg-amber-500/5 shadow-inner' : 'border-border/40 bg-muted/20'}`}>
              <User className={`w-5 h-5 ${isEditing ? 'text-amber-500' : 'text-muted-foreground/50'}`} />
              {isEditing ? (
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  maxLength={64}
                  className="bg-transparent border-none p-0 focus:ring-0 text-sm font-semibold w-full placeholder:font-normal"
                  placeholder="Enter your name"
                />
              ) : (
                <span className="text-sm font-semibold">{displayName}</span>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-muted-foreground tracking-wider ml-1">Phone Number</label>
            <div className="flex items-center gap-3 p-4 rounded-2xl border border-border/40 bg-muted/20">
              <Smartphone className="w-5 h-5 text-muted-foreground/50" />
              {/* Saku never stores the plain phone number (only its keccak256 hash) — there is
                  nothing here to display or edit, by design, not by omission. */}
              <span className="text-sm font-semibold text-muted-foreground">Verified via WhatsApp</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-muted-foreground tracking-wider ml-1">Saku ID (Wallet)</label>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-3 p-4 rounded-2xl border border-border/40 bg-muted/20">
                <Wallet className="w-5 h-5 text-muted-foreground/50" />
                <span className="text-xs font-mono font-medium truncate">{walletAddress || 'Not generated yet'}</span>
              </div>
              <button
                onClick={() => copy(walletAddress, 'wallet')}
                disabled={!walletAddress}
                className="p-4 bg-muted/50 rounded-2xl hover:bg-amber-500 hover:text-white transition-all disabled:opacity-40"
              >
                {copiedField === 'wallet' ? <CheckCircle className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

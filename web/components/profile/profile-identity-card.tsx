"use client"

/**
 * The card at the top of the profile: who this account is, and the picture on it.
 *
 * It carries the same rim as the balance card on Home, in the same oranges — these are the two
 * "this is your account" objects in the app and they had drifted into two different looks. The
 * mount sweep is off, because this screen has several cards and a sweep on each one on arrival
 * is a light show rather than a flourish.
 *
 * It shows identity and nothing else. Every editable fact used to be printed here *and* again in
 * a panel underneath, so the name and the wallet address each appeared twice on one screen while
 * the settings that actually have a state were pushed below the fold. The facts now live in
 * `AccountDetails` as rows; this is the anchor above them.
 *
 * Split out of the old `ProfileCard`, which was this card and that panel in one file.
 */

import { useRef, useState } from "react"
import { Camera, Loader2, User } from "lucide-react"
import { toast } from "sonner"
import { useAuth } from "@/hooks/useAuth"
import BorderGlow from "@/components/ui/border-glow"
import SandTexture from "@/components/ui/sand-texture"

export default function ProfileIdentityCard() {
  const { isAuthenticated, user, wallet, refreshUser } = useAuth()
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const handleAvatarSelect = (file: File) => {
    if (!isAuthenticated) return
    setUploadingAvatar(true)

    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const res = await fetch("/api/profile/avatar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: reader.result }),
        })
        const result = await res.json()
        if (!res.ok) throw new Error(result.error || "Failed")

        await refreshUser()
        toast.success("Profile picture updated")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not upload profile picture")
      } finally {
        setUploadingAvatar(false)
      }
    }
    reader.onerror = () => {
      toast.error("Could not read that image")
      setUploadingAvatar(false)
    }
    reader.readAsDataURL(file)
  }

  const displayName = user?.display_name || "Saku User"
  const walletAddress = wallet?.address || null

  return (
    <BorderGlow
      borderRadius={40}
      backgroundColor="#0A0A0A"
      glowColor="32 90 62"
      glowRadius={32}
      glowIntensity={0.9}
      colors={["#F0A353", "#FFD362", "#C97F1D"]}
      fillOpacity={0.45}
      className="w-full"
    >
      <div className="relative w-full rounded-[2.5rem] p-6 text-white overflow-hidden group">
        <div className="absolute inset-0 bg-[#0A0A0A]" />

        <div className="absolute inset-0 opacity-40">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,#f59e0b20,transparent_70%)]" />
          <div className="absolute inset-0 bg-gradient-to-tr from-amber-900/20 via-transparent to-orange-500/10" />
        </div>

        {/* Was a texture fetched from a third-party host, so the card rendered flat whenever that
            host was slow or unreachable. Same grain, inline, and it is what the balance card on
            Home already uses. */}
        <SandTexture opacity={0.28} grainSize={110} />

        <div className="absolute -top-24 -right-24 w-64 h-64 bg-amber-500/10 blur-[100px] rounded-full" />
        <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-orange-600/10 blur-[100px] rounded-full" />

        <div className="relative z-10 flex items-center gap-4">
          <div className="relative shrink-0">
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleAvatarSelect(file)
                e.target.value = ""
              }}
            />
            <button
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
              aria-label="Change profile picture"
              className="w-20 h-20 rounded-2xl bg-white/10 border border-white/20 overflow-hidden flex items-center justify-center transition-colors hover:border-amber-500/50 disabled:opacity-60"
            >
              {uploadingAvatar ? (
                <Loader2 className="w-6 h-6 animate-spin opacity-60" />
              ) : user?.avatar_url ? (
                <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <User className="w-8 h-8 opacity-25" />
              )}
            </button>
            <span className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-amber-500 border-2 border-[#0A0A0A] flex items-center justify-center pointer-events-none">
              <Camera className="w-3.5 h-3.5 text-black" />
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-2xl font-semibold tracking-tight truncate leading-tight">
              {displayName}
            </p>
            {/* The address in the shortened form, because the copyable full one is a row below.
                Printing all 42 characters here and again underneath was the duplication this
                card was carrying. */}
            <p className="mt-2 font-mono text-[12px] tracking-[0.08em] text-amber-100/70 truncate">
              {walletAddress
                ? `${walletAddress.slice(0, 6)} •••• ${walletAddress.slice(-4)}`
                : "Wallet not generated yet"}
            </p>
          </div>
        </div>
      </div>
    </BorderGlow>
  )
}

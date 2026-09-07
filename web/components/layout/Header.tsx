"use client"

import { ArrowLeft } from "lucide-react"
import { useRouter, usePathname } from "next/navigation"

interface HeaderProps {
  title?: string;
  showBack?: boolean;
}

export default function Header({ title, showBack = true }: HeaderProps) {
  const router = useRouter()
  const pathname = usePathname()

  const getAutoTitle = () => {
    if (title) return title;
    switch (pathname) {
      case "/pay": return "Finance Hub";
      case "/topup": return "Top Up IDRX";
      case "/transfer": return "Send Money";
      case "/withdraw": return "Withdraw Funds";
      default: return "Saku";
    }
  }

  return (
    <div className="p-6 flex items-center justify-center border-b border-border bg-white/50 backdrop-blur-md sticky top-0 z-30 overflow-hidden min-h-[80px]">
      {showBack && (
        <div className="absolute left-6">
          <button 
            onClick={() => router.back()} 
            className="p-2 hover:bg-primary/10 rounded-xl transition-all active:scale-90 group relative"
          >
            <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full opacity-0 group-active:opacity-100 transition-opacity" />
            <ArrowLeft className="w-6 h-6 text-black/85 relative z-10" />
          </button>
        </div>
      )}
      
      <h1 className="text-xl font-semibold tracking-tight text-black/85 capitalize text-center">
        {getAutoTitle()}
      </h1>
    </div>
  )
}
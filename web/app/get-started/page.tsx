"use client"

import React, { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/useAuth"
import { useMpcWallet } from "@/hooks/useMpcWallet"
import { toast } from "sonner"
import CountryCodeDropdown from "@/components/get-started/country-code-dropdown"

/**
 * National numbers are shorter outside Indonesia — Malaysia runs to nine digits without its
 * leading zero and Singapore to eight, both of which a ten-digit floor rejected outright. This
 * only stops an obviously half-typed number; `lib/phone.ts` does the real E.164 check
 * server-side, and it is the one that should decide.
 */
const MIN_NATIONAL_DIGITS = 6

export default function LoginScreen() {
  const router = useRouter()
  const { refreshUser, isAuthenticated, isLoading, setToken } = useAuth()
  const { login: mpcLogin } = useMpcWallet()

  const [loginMethod, setLoginMethod] = useState<"phone" | "otp" | null>(null)
  const [phone, setPhone] = useState("")
  const [selectedCountryCode, setSelectedCountryCode] = useState("+62")
  const [otp, setOtp] = useState<string[]>(new Array(4).fill(""))
  const [loading, setLoading] = useState(false)
  // Verifying the code and building the MPC wallet are two visibly different waits — the
  // second involves loading a WASM threshold library and a network round trip, so labelling
  // it "Verifying..." would look frozen.
  const [phase, setPhase] = useState<"verifying" | "wallet">("verifying")
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/home')
    }
  }, [isAuthenticated, isLoading, router])

  const formatPhone = (num: string) => {
    const cleanNum = num.replace(/\D/g, '');
    const countryCode = selectedCountryCode.replace('+', '');
    if (cleanNum.startsWith('0')) return `${countryCode}${cleanNum.slice(1)}`;
    return cleanNum.startsWith(countryCode) ? cleanNum : `${countryCode}${cleanNum}`;
  }

  const handleSendOtp = async () => {
    if (phone.replace(/\D/g, '').length < MIN_NATIONAL_DIGITS) return toast.error("Invalid phone number");

    setLoginMethod("otp");
    setLoading(true);
    
    try {
      const res = await fetch('/api/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          phone: formatPhone(phone), 
          countryCode: selectedCountryCode.replace('+', '') 
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to send code");
      toast.success('Verification code sent! 📲');
    } catch (err: any) {
      toast.error(err.message);
      setLoginMethod("phone");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (loading) return;
    setLoading(true);

    const otpString = otp.join("");
    const formattedPhone = formatPhone(phone);

    try {
      const res = await fetch('/api/verify-otp', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The dialing code has to ride along: the server derives the user's country from it at
        // signup, which is what decides the currency they are billed in later.
        body: JSON.stringify({
          phone: formattedPhone,
          otp: otpString,
          countryCode: selectedCountryCode.replace('+', ''),
        }),
      });
      
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Verification failed");

      if (result.isNewUser) {
        localStorage.setItem("saku_just_registered", "true");
        localStorage.removeItem("saku_has_seen_onboarding");
      }

      setToken(result.token);
      toast.success(result.isNewUser ? "Account created!" : "Welcome back!");

      // Derive the wallet now rather than on the home screen, so the user lands on a screen
      // that already has an address. A failure here is not fatal: home offers the same step
      // again, and the session is already valid either way.
      setPhase("wallet");
      try {
        await mpcLogin(result.token);
      } catch {
        toast.error("Wallet setup didn't finish — you can retry it from home.");
      }

      await refreshUser();
      router.push('/home');

    } catch (err: any) {
      toast.error(err.message);
      setPhase("verifying");
      setLoading(false);
    }
  };

  if (isLoading) return (
    <div className="min-h-screen bg-[#F9EFE5] flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-black border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-6 py-12 bg-[#F9EFE5] font-sans overflow-hidden">
      <div className="w-full max-w-[360px] mx-auto">
        
        {loginMethod === null && (
          <div className="animate-in fade-in zoom-in-95 duration-500 flex flex-col items-center text-center">
            <div className="w-64 h-64 mb-10 flex items-center justify-center">
              <video autoPlay loop muted playsInline className="w-full h-full object-contain mix-blend-multiply">
                <source src="/logo.webm" type="video/webm" />
              </video>
            </div>
            <h2 className="text-3xl font-black text-black mb-2 tracking-tight">Saku</h2>
            <p className="text-[#7F8790] text-sm mb-12 leading-relaxed">
              Experience the next generation of <br/> non-custodial digital finance.
            </p>
            <div className="w-full space-y-3">
              <button 
                onClick={() => setLoginMethod("phone")} 
                className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-xl active:scale-95 transition-all"
              >
                Sign In
              </button>
              <button 
                onClick={() => setLoginMethod("phone")} 
                className="w-full py-4 bg-white text-black rounded-2xl font-bold border-2 border-black/5 active:scale-95 transition-all shadow-sm"
              >
                Create Account
              </button>
            </div>
          </div>
        )}

        {loginMethod === "phone" && (
          <div className="animate-in slide-in-from-bottom-4 duration-300">
            <button onClick={() => setLoginMethod(null)} className="mb-10 flex items-center text-[#7F8790] font-bold text-sm hover:text-black transition-colors">
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" /></svg>
              Go Back
            </button>
            <h2 className="text-3xl font-black text-black mb-2">Phone Number</h2>
            <p className="text-[#7F8790] mb-8 text-sm">We will send a secure verification code to your WhatsApp.</p>
            <div className="space-y-6">
              <div className="space-y-2.5">
                <div className="relative group">
                  <CountryCodeDropdown onSelect={setSelectedCountryCode} selectedCode={selectedCountryCode} />
                  <input
                    type="tel"
                    value={phone}
                    autoFocus
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="812 3456 7890"
                    className="w-full pl-28 pr-4 py-4 bg-white border-2 border-transparent rounded-2xl text-lg font-bold shadow-sm focus:border-black outline-none transition-all"
                  />
                </div>
                {/*
                  Sitting against the input rather than in the heading above, because this is the
                  one fact that changes what someone types and the heading is already read and
                  forgotten by the time the cursor lands here. WhatsApp is the only channel Saku
                  has — there is no SMS fallback — so a number without an account on it gets a
                  code that can never arrive, and the failure is silent from the user's side.
                */}
                <p className="flex items-start gap-1.5 px-1 text-xs leading-relaxed text-[#7F8790]">
                  <svg className="w-3.5 h-3.5 mt-px shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 004.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0012.04 2zm0 18.15h-.01a8.2 8.2 0 01-4.18-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.18 8.18 0 01-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 012.41 5.83c0 4.54-3.7 8.23-8.24 8.23z" />
                  </svg>
                  <span>Use a number with an active WhatsApp account. The code is sent there, never by SMS.</span>
                </p>
              </div>
              <button
                onClick={handleSendOtp} 
                disabled={phone.replace(/\D/g, '').length < MIN_NATIONAL_DIGITS || loading} 
                className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-lg disabled:opacity-30 active:scale-[0.98] transition-all"
              >
                {loading ? "Sending Code..." : "Continue"}
              </button>
            </div>
          </div>
        )}

        {loginMethod === "otp" && (
          <div className="animate-in slide-in-from-bottom-4 duration-300">
            <button onClick={() => setLoginMethod("phone")} className="mb-10 flex items-center text-[#7F8790] font-bold text-sm" disabled={loading}>
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" /></svg>
              Change Number
            </button>
            <h2 className="text-3xl font-black text-black mb-2">Verify Identity</h2>
            <p className="text-[#7F8790] mb-10 text-sm">Enter the code sent to your WhatsApp.</p>
            <div className="flex justify-between gap-3 mb-10">
              {otp.map((data, i) => (
                <input 
                  key={i} 
                  type="number"
                  inputMode="numeric"
                  autoFocus={i === 0}
                  ref={(el) => { inputRefs.current[i] = el }} 
                  value={data} 
                  onChange={(e) => {
                    const val = e.target.value.slice(-1);
                    const nextOtp = [...otp];
                    nextOtp[i] = val;
                    setOtp(nextOtp);
                    if (val && i < 3) inputRefs.current[i + 1]?.focus();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !otp[i] && i > 0) {
                      inputRefs.current[i-1]?.focus();
                    }
                  }} 
                  className="w-[22%] aspect-square bg-white border-2 border-transparent rounded-2xl text-center font-black text-2xl shadow-sm focus:border-black outline-none transition-all" 
                />
              ))}
            </div>
            <button 
              onClick={handleVerifyOtp} 
              disabled={otp.some(v => !v) || loading} 
              className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-lg disabled:opacity-30 active:scale-[0.98] transition-all"
            >
              {loading ? (phase === "wallet" ? "Setting up your wallet..." : "Verifying...") : "Verify OTP"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
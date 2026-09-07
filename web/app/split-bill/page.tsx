"use client"

/**
 * Split bills — what you are owed, and what you owe.
 *
 * Creating a bill records shares; it does not collect anything. Each participant pays their own
 * share with their own signature, so nothing sits in a middle account waiting to be released.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Loader2, Plus, Receipt, Trash2, Users2, X } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useSplitBills } from "@/hooks/useSplitBill"
import CountryCodeDropdown from "@/components/get-started/country-code-dropdown"
import BottomNavigation from "@/components/home/bottom-navigation"

interface Participant {
  phone: string
  label: string
}

export default function SplitBillPage() {
  const router = useRouter()
  const { user, isLoading, isAuthenticated } = useAuth()
  const { created, owed, isLoading: loadingBills, error, createBill } = useSplitBills()

  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState("")
  const [total, setTotal] = useState("")
  const [countryCode, setCountryCode] = useState("+62")
  const [participants, setParticipants] = useState<Participant[]>([{ phone: "", label: "" }])

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/get-started")
  }, [isLoading, isAuthenticated, router])

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-black/20" />
      </div>
    )
  }

  if (!user) return null

  const filled = participants.filter((p) => p.phone.length >= 8)
  const totalNum = Number(total)
  const perHead = filled.length > 0 && totalNum > 0 ? (totalNum / filled.length).toFixed(2) : null
  const canCreate = title.trim().length > 0 && totalNum > 0 && filled.length > 0

  const submit = async () => {
    setBusy(true)
    const id = await createBill({
      title: title.trim(),
      totalAmount: totalNum,
      participants: filled.map((p) => ({ phone: p.phone, label: p.label.trim() || undefined })),
      countryCode: countryCode.replace("+", ""),
    })
    setBusy(false)
    if (id) {
      setCreating(false)
      setTitle("")
      setTotal("")
      setParticipants([{ phone: "", label: "" }])
      router.push(`/split-bill/${id}`)
    }
  }

  return (
    <div className="min-h-dvh bg-white font-sans max-w-lg mx-auto">
      <div className="px-5 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => (creating ? setCreating(false) : router.push("/home"))}
            aria-label="Back"
            className="p-2 -ml-2 rounded-full hover:bg-black/5 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-black tracking-tight">Split Bill</h1>
        </div>

        {creating ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-black/45">
                What&apos;s it for
              </label>
              <input
                value={title}
                autoFocus
                maxLength={80}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Dinner at Sate Pak Kumis"
                className="w-full px-4 py-3 bg-[#FAFAFA] border-2 border-transparent rounded-2xl text-sm font-semibold focus:border-black outline-none transition-all"
              />
            </div>

            <div className="rounded-3xl border border-black/8 bg-[#FAFAFA] px-5 py-6 text-center">
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-black/35">Total</p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <input
                  inputMode="decimal"
                  value={total}
                  onChange={(e) => setTotal(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder="0"
                  className="w-full max-w-[160px] bg-transparent outline-none text-center text-4xl font-black tabular-nums placeholder:text-black/15"
                />
                <span className="text-lg font-bold text-black/35">USDC</span>
              </div>
              {perHead && (
                <p className="mt-3 text-sm text-black/45">
                  {perHead} USDC each · {filled.length} {filled.length === 1 ? "person" : "people"}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-black/45">
                Who split it
              </label>
              {participants.map((p, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={p.label}
                    maxLength={64}
                    onChange={(e) => {
                      const next = [...participants]
                      next[i] = { ...next[i], label: e.target.value }
                      setParticipants(next)
                    }}
                    placeholder="Name"
                    className="w-28 shrink-0 px-3 py-3 bg-[#FAFAFA] border-2 border-transparent rounded-2xl text-sm font-semibold focus:border-black outline-none"
                  />
                  <input
                    type="tel"
                    value={p.phone}
                    onChange={(e) => {
                      const next = [...participants]
                      next[i] = { ...next[i], phone: e.target.value.replace(/\D/g, "") }
                      setParticipants(next)
                    }}
                    placeholder="812 3456 7890"
                    className="flex-1 min-w-0 px-3 py-3 bg-[#FAFAFA] border-2 border-transparent rounded-2xl text-sm font-bold focus:border-black outline-none"
                  />
                  {participants.length > 1 && (
                    <button
                      onClick={() => setParticipants(participants.filter((_, idx) => idx !== i))}
                      aria-label="Remove"
                      className="p-3 rounded-2xl text-black/30 hover:bg-red-50 hover:text-red-600 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}

              <div className="flex items-center gap-2">
                <CountryCodeDropdown onSelect={setCountryCode} selectedCode={countryCode} />
                <button
                  onClick={() => setParticipants([...participants, { phone: "", label: "" }])}
                  className="flex-1 ml-24 py-3 rounded-2xl border-2 border-dashed border-black/12 text-xs font-bold text-black/55 hover:border-black/25 transition-colors"
                >
                  <Plus className="w-4 h-4 inline mr-1" /> Add person
                </button>
              </div>
            </div>

            {error && <p className="text-sm font-medium text-red-600">{error}</p>}

            <button
              onClick={submit}
              disabled={!canCreate || busy}
              className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-lg disabled:opacity-25 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {busy ? "Creating…" : "Create bill"}
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={() => setCreating(true)}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-black text-white text-sm font-bold active:scale-[0.98] transition-transform"
            >
              <Plus className="w-4 h-4" /> New split bill
            </button>

            {owed.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-black/35 px-1">
                  You owe
                </p>
                {owed.map((s) => (
                  <button
                    key={s.shareId}
                    onClick={() => router.push(`/split-bill/${s.billId}`)}
                    className="w-full flex items-center gap-3 p-3.5 rounded-2xl border border-black/6 hover:bg-black/[0.02] transition-colors text-left"
                  >
                    <div className="w-10 h-10 rounded-2xl bg-orange-100 text-[#F0A353] flex items-center justify-center shrink-0">
                      <Receipt className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold truncate">{s.title}</p>
                      <p className="text-[11px] text-black/40 capitalize">{s.status}</p>
                    </div>
                    <p className="text-sm font-black tabular-nums shrink-0">{s.amount} USDC</p>
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-black/35 px-1">
                Your bills
              </p>

              {loadingBills && created.length === 0 ? (
                <div className="py-10 flex justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-black/20" />
                </div>
              ) : created.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <Users2 className="w-8 h-8 mx-auto text-black/15" />
                  <p className="text-xs font-medium text-black/40">No bills yet</p>
                </div>
              ) : (
                created.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => router.push(`/split-bill/${b.id}`)}
                    className="w-full flex items-center gap-3 p-3.5 rounded-2xl border border-black/6 hover:bg-black/[0.02] transition-colors text-left"
                  >
                    <div className="w-10 h-10 rounded-2xl bg-purple-100 text-purple-600 flex items-center justify-center shrink-0">
                      <Users2 className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold truncate">{b.title}</p>
                      <p className="text-[11px] text-black/40 capitalize">{b.status}</p>
                    </div>
                    <p className="text-sm font-black tabular-nums shrink-0">{b.totalAmount} USDC</p>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {!creating && <BottomNavigation />}
    </div>
  )
}

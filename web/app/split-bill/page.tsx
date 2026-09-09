"use client"

/**
 * Split bills — what you are owed, and what you owe.
 *
 * Creating a bill records shares; it does not collect anything. Each participant pays their own
 * share with their own signature, so nothing sits in a middle account waiting to be released.
 *
 * Two ways to divide it. **Evenly** is the old behaviour, kept because most bills genuinely are
 * one number over a headcount. **By item** is what a scanned receipt is actually for: `/api/ocr`
 * has returned line items, quantities and tax all along, and they used to be summed into a
 * single figure and thrown away. Assigning lines to people, then sharing tax and service in
 * proportion to what each person ordered, is the arithmetic in `lib/split-bill-math.ts`.
 *
 * You are a participant in item mode and not in even mode, which is not an inconsistency: the
 * receipt has to add up including what *you* ate, but you are not going to charge yourself for
 * it. What the others owe is the bill's total; the full receipt lives in the breakdown.
 */

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import {
  ArrowLeft,
  ArrowLeftRight,
  BookUser,
  Camera,
  ImageUp,
  Loader2,
  Plus,
  Check,
  Receipt,
  User,
  Users2,
  X,
} from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useSplitBills, type BillBreakdown } from "@/hooks/useSplitBill"
import { useCurrencyToggleAmount } from "@/hooks/useCurrencyToggleAmount"
import {
  EMPTY_CHARGES,
  formatMoney,
  splitBill,
  type BillCharges,
  type BillItem,
} from "@/lib/split-bill-math"
import { formatCurrency } from "@/lib/currency"
import CountryCodeDropdown from "@/components/get-started/country-code-dropdown"
import CameraCapture from "@/components/shared/camera-capture"
import ItemEditor from "@/components/split-bill/item-editor"
import ContactPickerList from "@/components/shared/contact-picker-list"
import BottomNavigation from "@/components/home/bottom-navigation"
import { useRecipientCountryCode } from "@/hooks/useRecipientCountryCode"

interface Participant {
  id: string
  phone: string
  label: string
  /**
   * Set when this person came from the address book. The server accepts either this or a typed
   * number — a saved contact only has a number on the device that saved it, so the hash is what
   * makes contacts usable from anywhere.
   */
  phoneHash?: string
}

interface ScannedReceipt {
  description?: string
  items?: { name: string; price: number; qty: number }[]
  totalTax?: number
  totalDiscount?: number
}

type Tab = "new" | "owed" | "mine"

const TABS: { id: Tab; label: string; icon: typeof Receipt }[] = [
  { id: "new", label: "New", icon: Plus },
  { id: "owed", label: "To pay", icon: Receipt },
  { id: "mine", label: "Mine", icon: Users2 },
]

/** The bill's creator, in the item-assignment list only. Never gets a share of their own bill. */
const ME = "me"

function newParticipant(): Participant {
  return { id: crypto.randomUUID(), phone: "", label: "" }
}

function SplitBillView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, isLoading, isAuthenticated } = useAuth()
  const { created, owed, isLoading: loadingBills, error, createBill } = useSplitBills()

  const requestedTab = searchParams.get("tab") as Tab | null
  const [tab, setTab] = useState<Tab>(
    requestedTab && TABS.some((t) => t.id === requestedTab) ? requestedTab : "owed"
  )
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState("")
  const [mode, setMode] = useState<"even" | "items">("even")
  const totalField = useCurrencyToggleAmount(isAuthenticated)
  const [countryCode, setCountryCode] = useRecipientCountryCode()
  const [participants, setParticipants] = useState<Participant[]>([newParticipant()])
  const [items, setItems] = useState<BillItem[]>([])
  const [charges, setCharges] = useState<BillCharges>(EMPTY_CHARGES)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [showCamera, setShowCamera] = useState(false)
  const [pickingContacts, setPickingContacts] = useState(false)
  const galleryInputRef = useRef<HTMLInputElement>(null)

  const currency = totalField.currency
  const unpaid = owed.filter((share) => share.status !== "paid")

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/get-started")
  }, [isLoading, isAuthenticated, router])

  const filled = participants.filter((p) => p.phoneHash || p.phone.length >= 8)

  /** Labels are optional; a chip reading "Person 2" is still better than an empty one. */
  const namedParticipants = useMemo(
    () =>
      participants.map((p, i) => ({
        id: p.id,
        label: p.label.trim() || `Person ${i + 1}`,
      })),
    [participants]
  )

  const assignmentList = useMemo(
    () => [{ id: ME, label: "You" }, ...namedParticipants],
    [namedParticipants]
  )

  const split = useMemo(
    () => splitBill(items, charges, assignmentList.map((p) => p.id)),
    [items, charges, assignmentList]
  )

  const totalsById = useMemo(
    () => new Map(split.perPerson.map((p) => [p.participantId, p])),
    [split]
  )

  /** In item mode the number that matters is what the *others* owe, not the receipt total. */
  const owedLocal = useMemo(
    () =>
      namedParticipants.reduce((sum, p) => sum + (totalsById.get(p.id)?.total ?? 0), 0),
    [namedParticipants, totalsById]
  )

  // A receipt is priced in local currency; shares are USDC. With no rate available the figures
  // are treated as USDC already, which is the only honest fallback.
  const fxRate = currency?.fxRate ?? 1
  const owedUsdc = owedLocal / fxRate

  const totalNum = mode === "items" ? owedUsdc : Number(totalField.amountUsdc)
  const perHead = mode === "even" && filled.length > 0 && totalNum > 0
    ? (totalNum / filled.length).toFixed(2)
    : null

  const canCreate =
    title.trim().length > 0 &&
    totalNum > 0 &&
    filled.length > 0 &&
    // Every participant must be reachable — a bill with a half-typed number saves a share
    // nobody can ever pay.
    filled.length === participants.length

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-black/20" />
      </div>
    )
  }

  if (!user) return null

  const scanReceipt = (file: File) => {
    setScanning(true)
    setScanError(null)

    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const res = await fetch("/api/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: reader.result }),
        })
        const data = (await res.json()) as ScannedReceipt & { success: boolean; error?: string }
        if (!res.ok || !data.success) throw new Error(data.error || "Could not read that receipt")

        if (data.description) setTitle(data.description)

        const scannedItems = (data.items ?? [])
          .filter((item) => Number.isFinite(item.price))
          .map((item) => ({
            id: crypto.randomUUID(),
            name: item.name,
            price: Number(item.price) || 0,
            qty: Math.max(1, Number(item.qty) || 1),
            assignedTo: [] as string[],
          }))

        setCharges({
          tax: Number(data.totalTax) || 0,
          service: 0,
          discount: Number(data.totalDiscount) || 0,
        })

        if (scannedItems.length > 0) {
          // The whole point of scanning is the lines. Landing on the even-split screen with the
          // lines hidden behind a mode toggle would be throwing the scan away again.
          setItems(scannedItems)
          setMode("items")
        } else {
          const localTotal =
            (data.items ?? []).reduce((sum, item) => sum + item.price * (item.qty || 1), 0) +
            (data.totalTax ?? 0) -
            (data.totalDiscount ?? 0)
          if (localTotal > 0) {
            const rate =
              currency?.fxRate ??
              (await fetch("/api/offramp/quote")
                .then((res) => res.json())
                .then((quote) => Number(quote?.fxRate))
                .catch(() => NaN))
            totalField.setAmountUsdcDirect((rate > 0 ? localTotal / rate : localTotal).toFixed(2))
          }
        }
      } catch (err) {
        setScanError(err instanceof Error ? err.message : "Could not read that receipt")
      } finally {
        setScanning(false)
      }
    }
    reader.onerror = () => {
      setScanError("Could not read that image")
      setScanning(false)
    }
    reader.readAsDataURL(file)
  }

  const resetForm = () => {
    setCreating(false)
    setTitle("")
    setMode("even")
    totalField.reset()
    setParticipants([newParticipant()])
    setItems([])
    setCharges(EMPTY_CHARGES)
  }

  const submit = async () => {
    setBusy(true)

    const breakdown: BillBreakdown | undefined =
      mode === "items"
        ? {
            currency: currency
              ? {
                  code: currency.code,
                  symbol: currency.symbol,
                  decimals: currency.decimals,
                  locale: currency.locale,
                  fxRate: currency.fxRate,
                }
              : null,
            items,
            charges,
            participants: assignmentList,
          }
        : undefined

    const id = await createBill({
      title: title.trim(),
      totalAmount: Number(totalNum.toFixed(6)),
      participants: filled.map((p) => {
        const who = p.phoneHash ? { phoneHash: p.phoneHash } : { phone: p.phone }
        const label = p.label.trim() || undefined
        if (mode !== "items") return { ...who, label }

        const person = totalsById.get(p.id)
        return {
          ...who,
          label,
          amount: Number(((person?.total ?? 0) / fxRate).toFixed(6)),
          breakdown: person,
        }
      }),
      countryCode: countryCode.replace("+", ""),
      breakdown,
    })

    setBusy(false)
    if (id) {
      resetForm()
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

        {!creating && (
          <div className="flex p-1 bg-black/[0.04] rounded-2xl">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => (id === "new" ? setCreating(true) : setTab(id))}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all ${
                  tab === id ? "bg-white shadow-sm text-black" : "text-black/45 hover:text-black/70"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
                {id === "owed" && unpaid.length > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-purple-600 text-white text-[9px] leading-none">
                    {unpaid.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {creating ? (
          <div className="space-y-4">
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void scanReceipt(file)
                e.target.value = ""
              }}
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowCamera(true)}
                disabled={scanning}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-black/12 text-sm font-bold text-black/55 hover:border-black/25 transition-colors disabled:opacity-50"
              >
                {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                {scanning ? "Reading…" : "Take photo"}
              </button>
              <button
                onClick={() => galleryInputRef.current?.click()}
                disabled={scanning}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-black/12 text-sm font-bold text-black/55 hover:border-black/25 transition-colors disabled:opacity-50"
              >
                <ImageUp className="w-4 h-4" />
                Upload
              </button>
            </div>
            {showCamera && (
              <CameraCapture
                onCapture={(file) => {
                  setShowCamera(false)
                  void scanReceipt(file)
                }}
                onClose={() => setShowCamera(false)}
              />
            )}
            {scanError && <p className="text-xs font-medium text-red-600 text-center">{scanError}</p>}

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

            <div className="flex p-1 bg-black/[0.04] rounded-2xl">
              {(["even", "items"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    mode === m ? "bg-white shadow-sm text-black" : "text-black/45 hover:text-black/70"
                  }`}
                >
                  {m === "even" ? "Split evenly" : "By item"}
                </button>
              ))}
            </div>

            {/* Who split it — above the items in item mode, because you cannot assign a line to
                someone who is not on the bill yet. */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-black/45">
                Who split it
              </label>
              {participants.map((p, i) => (
                <div key={p.id} className="flex gap-2">
                  <input
                    value={p.label}
                    maxLength={64}
                    onChange={(e) =>
                      setParticipants(
                        participants.map((x) => (x.id === p.id ? { ...x, label: e.target.value } : x))
                      )
                    }
                    placeholder={`Person ${i + 1}`}
                    className="w-28 shrink-0 px-3 py-3 bg-[#FAFAFA] border-2 border-transparent rounded-2xl text-sm font-semibold focus:border-black outline-none"
                  />
                  {p.phoneHash ? (
                    // A contact has no number on this device to show, and nothing to type.
                    <div className="flex-1 min-w-0 flex items-center gap-2 px-4 py-3 bg-[#FAFAFA] border-2 border-transparent rounded-2xl">
                      <User className="w-3.5 h-3.5 text-black/30 shrink-0" />
                      <span className="text-sm font-bold text-black/55 truncate">
                        {p.phone || "From contacts"}
                      </span>
                    </div>
                  ) : (
                    <div className="relative flex-1 min-w-0">
                      <CountryCodeDropdown onSelect={setCountryCode} selectedCode={countryCode} />
                      <input
                        type="tel"
                        value={p.phone}
                        onChange={(e) =>
                          setParticipants(
                            participants.map((x) =>
                              x.id === p.id ? { ...x, phone: e.target.value.replace(/\D/g, "") } : x
                            )
                          )
                        }
                        placeholder="812 3456 7890"
                        className="w-full pl-24 pr-3 py-3 bg-[#FAFAFA] border-2 border-transparent rounded-2xl text-sm font-bold focus:border-black outline-none"
                      />
                    </div>
                  )}
                  {participants.length > 1 && (
                    <button
                      onClick={() => {
                        setParticipants(participants.filter((x) => x.id !== p.id))
                        // Drop them off every line too, or the split keeps charging a ghost.
                        setItems((prev) =>
                          prev.map((item) => ({
                            ...item,
                            assignedTo: item.assignedTo.filter((id) => id !== p.id),
                          }))
                        )
                      }}
                      aria-label="Remove"
                      className="p-3 rounded-2xl text-black/30 hover:bg-red-50 hover:text-red-600 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}

              <div className="flex gap-2">
                <button
                  onClick={() => setParticipants([...participants, newParticipant()])}
                  className="flex-1 py-3 rounded-2xl border-2 border-dashed border-black/12 text-xs font-bold text-black/55 hover:border-black/25 transition-colors"
                >
                  <Plus className="w-4 h-4 inline mr-1" /> Add person
                </button>
                <button
                  onClick={() => setPickingContacts((v) => !v)}
                  className={`flex-1 py-3 rounded-2xl border-2 text-xs font-bold transition-colors ${
                    pickingContacts
                      ? "border-black bg-black text-white"
                      : "border-dashed border-black/12 text-black/55 hover:border-black/25"
                  }`}
                >
                  <BookUser className="w-4 h-4 inline mr-1" /> From contacts
                </button>
              </div>

              <AnimatePresence initial={false}>
                {pickingContacts && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <ContactPickerList
                      selected={participants.map((p) => p.phoneHash).filter((h): h is string => !!h)}
                      onChange={(_, picked) => {
                        // Contacts replace only the contact-backed rows; anything typed by hand
                        // stays exactly as it was.
                        const typed = participants.filter((p) => !p.phoneHash && p.phone)
                        setParticipants([
                          ...typed,
                          ...picked.map((c) => ({
                            id: c.phoneHash,
                            phone: c.phone ?? "",
                            label: c.label,
                            phoneHash: c.phoneHash,
                          })),
                          // Keep one empty row so "add someone not in my contacts" stays possible.
                          ...(typed.length + picked.length === 0 ? [newParticipant()] : []),
                        ])
                      }}
                      emptyHint="Save a contact from Profile → Contacts, or type a number above."
                      footer={(count) => (
                        <p className="text-[11px] text-center text-black/40">
                          {count} {count === 1 ? "person" : "people"} from contacts
                        </p>
                      )}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {mode === "items" ? (
              <>
                <ItemEditor
                  items={items}
                  onChange={setItems}
                  participants={assignmentList}
                  currency={currency}
                />

                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ["tax", "Tax / PPN"],
                      ["service", "Service"],
                      ["discount", "Discount"],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key} className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-black/45">
                        {label}
                      </label>
                      <input
                        inputMode="decimal"
                        value={charges[key] || ""}
                        onChange={(e) =>
                          setCharges({
                            ...charges,
                            [key]: Number(e.target.value.replace(/[^\d.]/g, "")) || 0,
                          })
                        }
                        placeholder="0"
                        className="w-full px-3 py-3 bg-[#FAFAFA] border-2 border-transparent rounded-2xl text-sm font-bold tabular-nums text-right focus:border-black outline-none"
                      />
                    </div>
                  ))}
                </div>

                <div className="rounded-3xl border border-black/8 bg-[#FAFAFA] p-5 space-y-3">
                  <div className="flex items-baseline justify-between text-xs font-semibold text-black/45">
                    <span>Receipt total</span>
                    <span className="tabular-nums">{formatMoney(split.total, currency)}</span>
                  </div>

                  <div className="h-px bg-black/[0.07]" />

                  {assignmentList.map((person) => {
                    const total = totalsById.get(person.id)
                    const isMe = person.id === ME
                    return (
                      <div key={person.id} className="space-y-0.5">
                        <div className="flex items-baseline justify-between">
                          <p className={`text-sm font-bold ${isMe ? "text-black/45" : ""}`}>
                            {person.label}
                            {isMe && " (not charged)"}
                          </p>
                          <p className={`text-sm font-black tabular-nums ${isMe ? "text-black/35" : ""}`}>
                            {formatMoney(total?.total ?? 0, currency)}
                          </p>
                        </div>
                        {(total?.items.length ?? 0) > 0 && (
                          <p className="text-[10px] text-black/35 truncate">
                            {total!.items.map((i) => i.name || "Item").join(", ")}
                            {total!.tax + total!.service > 0 &&
                              ` · +${formatMoney(total!.tax + total!.service, currency)} tax/service`}
                          </p>
                        )}
                      </div>
                    )
                  })}

                  <div className="h-px bg-black/[0.07]" />

                  <div className="flex items-baseline justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-black/45">
                      Owed to you
                    </p>
                    <div className="text-right">
                      <p className="text-2xl font-black tabular-nums leading-none">
                        {owedUsdc.toFixed(2)} <span className="text-sm text-black/35">USDC</span>
                      </p>
                      {currency && (
                        <p className="text-[11px] font-semibold text-black/40 mt-1">
                          {formatMoney(owedLocal, currency)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-3xl border border-black/8 bg-[#FAFAFA] px-5 py-6 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-black/35">Total</p>
                <div className="mt-3 flex items-center justify-center gap-2">
                  <input
                    inputMode="decimal"
                    value={totalField.displayValue}
                    onChange={(e) => totalField.setDisplayValue(e.target.value)}
                    placeholder="0"
                    className="w-full max-w-[160px] bg-transparent outline-none text-center text-4xl font-black tabular-nums placeholder:text-black/15"
                  />
                  <button
                    type="button"
                    onClick={totalField.toggleUnit}
                    disabled={!currency}
                    className="flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-full bg-black/[0.06] hover:bg-black/10 active:scale-95 transition-all disabled:opacity-40 disabled:active:scale-100"
                  >
                    <ArrowLeftRight className="w-3 h-3 text-black/40" />
                    <span className="text-sm font-black text-black/70">{totalField.unitLabel}</span>
                  </button>
                </div>
                {currency && Number(totalField.amountUsdc) > 0 && (
                  <p className="mt-2 text-xs font-semibold text-black/40">
                    ≈{" "}
                    {totalField.unit === "usdc"
                      ? formatCurrency(Number(totalField.amountUsdc) * currency.fxRate, currency)
                      : `${totalField.amountUsdc} USDC`}
                  </p>
                )}
                {perHead && (
                  <p className="mt-3 text-sm text-black/45">
                    {perHead} USDC each · {filled.length} {filled.length === 1 ? "person" : "people"}
                  </p>
                )}
              </div>
            )}

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
            {tab === "owed" && (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between px-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-black/35">
                    Bills addressed to you
                  </p>
                  {unpaid.length > 0 && (
                    <p className="text-[11px] font-bold tabular-nums text-black/45">
                      {unpaid.reduce((sum, s) => sum + Number(s.amount), 0).toFixed(2)} USDC total
                    </p>
                  )}
                </div>

                {loadingBills && owed.length === 0 ? (
                  <div className="py-10 flex justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-black/20" />
                  </div>
                ) : owed.length === 0 ? (
                  <div className="py-10 text-center space-y-2">
                    <Receipt className="w-8 h-8 mx-auto text-black/15" />
                    <p className="text-xs font-medium text-black/40">Nothing to pay</p>
                    <p className="text-[11px] text-black/30">
                      A bill sent to your number shows up here without a link.
                    </p>
                  </div>
                ) : (
                  owed.map((s) => {
                    const paid = s.status === "paid"
                    return (
                      <button
                        key={s.shareId}
                        onClick={() => router.push(`/split-bill/${s.billId}`)}
                        className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border transition-colors text-left ${
                          paid ? "border-black/6 opacity-60" : "border-black/6 hover:bg-black/[0.02]"
                        }`}
                      >
                        <div
                          className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                            paid ? "bg-emerald-100 text-emerald-600" : "bg-purple-100 text-purple-600"
                          }`}
                        >
                          {paid ? <Check className="w-5 h-5" /> : <Receipt className="w-5 h-5" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold truncate">{s.title}</p>
                          <p className="text-[11px] text-black/40 truncate">
                            {s.fromName ? `From ${s.fromName}` : "Split bill"}
                            {paid ? " · paid" : ""}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-black tabular-nums">{Number(s.amount).toFixed(2)}</p>
                          <p className="text-[10px] font-semibold text-black/30">USDC</p>
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            )}

            {tab === "mine" && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-black/35 px-1">
                Bills you created
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
            )}
          </>
        )}
      </div>

      {!creating && <BottomNavigation />}
    </div>
  )
}

/** `useSearchParams` opts the tree into client rendering, which Next needs a boundary around. */
export default function SplitBillPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-white flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-black/20" />
        </div>
      }
    >
      <SplitBillView />
    </Suspense>
  )
}

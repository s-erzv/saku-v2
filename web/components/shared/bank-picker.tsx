"use client"

/**
 * Searchable bank picker — the plain `<select>` this replaces was unusable past a scroll or two
 * with Xendit's real bank list (150+ entries). Same modal pattern as `CountryCodeDropdown`.
 */

import { useState } from "react"
import { ChevronDown, Search } from "lucide-react"

export interface BankOption {
  code: string
  name: string
}

export default function BankPicker({
  banks,
  value,
  onSelect,
  loading,
}: {
  banks: BankOption[]
  value: string
  onSelect: (code: string) => void
  loading?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")

  const selected = banks.find((b) => b.code === value)
  const filtered = banks.filter((b) => b.name.toLowerCase().includes(searchTerm.toLowerCase()))

  const handleSelect = (bank: BankOption) => {
    onSelect(bank.code)
    setIsOpen(false)
    setSearchTerm("")
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        disabled={loading}
        className="w-full flex items-center justify-between px-4 py-4 bg-[#FAFAFA] border-2 border-transparent rounded-2xl text-base font-bold text-left focus:border-black outline-none transition-all disabled:opacity-50"
      >
        <span className={selected ? "text-black" : "text-black/35 font-normal"}>
          {loading ? "Loading banks…" : selected?.name ?? "Select a bank"}
        </span>
        <ChevronDown className="w-4 h-4 text-black/35 shrink-0" />
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm animate-in fade-in-20">
          <div className="w-full max-w-sm h-[80vh] bg-white rounded-2xl flex flex-col shadow-xl">
            <div className="p-4 border-b relative">
              <Search className="absolute left-8 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search bank..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-50 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
                autoFocus
              />
              <button
                onClick={() => setIsOpen(false)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 font-bold p-2"
              >
                &times;
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="p-6 text-center text-sm text-gray-400">No banks match &ldquo;{searchTerm}&rdquo;</p>
              ) : (
                filtered.map((bank) => (
                  <div
                    key={bank.code}
                    onClick={() => handleSelect(bank)}
                    className="flex items-center gap-4 px-6 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <span className="flex-1 text-gray-800">{bank.name}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

"use client"

/**
 * Country dialling-code picker: a trigger that sits inside a phone field, and the modal it opens.
 *
 * The modal is rendered through a portal onto `document.body` rather than in place. It is
 * `position: fixed`, and every screen that uses this puts the trigger inside a `relative`
 * wrapper next to the phone input — the moment any ancestor of that wrapper picks up a
 * `transform`, `filter` or `backdrop-filter`, it becomes the containing block for fixed
 * children and the dialog stops being measured against the viewport. That is what had it
 * hanging off the top of the screen with its search box cut in half and the page header showing
 * through it. A portal takes it out of that subtree entirely, so no layout choice made by a
 * calling screen can move it again.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import countryCodes from '@/lib/country-codes.json';
import { Check, Search, X } from 'lucide-react';

interface Country {
  name: string;
  dial_code: string;
  code: string;
}

interface CountryCodeDropdownProps {
  onSelect: (dialCode: string) => void;
  selectedCode: string;
}

/**
 * Saku's own markets, floated to the top of an otherwise alphabetical list.
 *
 * The list opened on Afghanistan, Åland Islands, Albania — three countries the app cannot charge
 * in, ahead of every country it can. Alphabetical order is the right default for a list of 200,
 * but it should not bury the six that account for essentially every user.
 */
const PRIORITY_ISO = ['ID', 'MY', 'SG', 'TH', 'VN', 'PH'];

export default function CountryCodeDropdown({ onSelect, selectedCode }: CountryCodeDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [mounted, setMounted] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // `document` does not exist during the server render, and a portal needs it. Rendering
  // nothing on the first client pass keeps the markup identical on both sides.
  useEffect(() => setMounted(true), []);

  const selectedCountry = countryCodes.find((c) => c.dial_code === selectedCode);

  const countries = useMemo(() => {
    const all = countryCodes as Country[];
    const term = searchTerm.trim().toLowerCase();

    const matches = term
      ? all.filter(
          (c) =>
            c.name.toLowerCase().includes(term) ||
            c.dial_code.includes(term) ||
            c.code.toLowerCase() === term
        )
      : all;

    // Searching means the person knows what they want, so ranking gets out of the way and the
    // result is plain alphabetical relevance.
    if (term) return matches;

    const priority = PRIORITY_ISO.map((iso) => matches.find((c) => c.code === iso)).filter(
      (c): c is Country => Boolean(c)
    );
    return [...priority, ...matches.filter((c) => !PRIORITY_ISO.includes(c.code))];
  }, [searchTerm]);

  /** How many leading rows are the pinned markets, so the divider lands in the right place. */
  const pinnedCount = searchTerm.trim() ? 0 : PRIORITY_ISO.length;

  useEffect(() => {
    if (!isOpen) return;

    // The page behind a full-screen dialog should not scroll with it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);

    // Focus after paint; focusing mid-render loses to the browser's own focus handling.
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 50);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [isOpen]);

  const close = () => {
    setIsOpen(false);
    setSearchTerm('');
  };

  const handleSelect = (country: Country) => {
    onSelect(country.dial_code);
    close();
  };

  const dialog = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Select country"
      // `p-4` is what stops the panel touching the screen edges, and the safe-area padding keeps
      // it clear of the notch and the home indicator on a phone.
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-150"
      style={{
        paddingTop: 'max(0px, env(safe-area-inset-top))',
        paddingBottom: 'max(0px, env(safe-area-inset-bottom))',
      }}
      onClick={close}
    >
      <div
        // Stops a click inside the panel from reaching the overlay's close handler.
        onClick={(event) => event.stopPropagation()}
        className="w-full sm:max-w-sm max-h-[85vh] sm:max-h-[70vh] bg-white rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden shadow-2xl animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
      >
        <div className="px-4 pt-4 pb-3 border-b border-black/5 shrink-0">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              {/* Anchored to the input, not to the padded row, so it cannot drift onto the text. */}
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/30" />
              <input
                ref={searchRef}
                type="text"
                inputMode="search"
                placeholder="Search country or code"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-11 pl-9 pr-3 bg-black/[0.04] rounded-xl text-sm font-medium placeholder:text-black/30 outline-none focus:bg-black/[0.06] transition-colors"
              />
            </div>
            {/* Its own button in the row rather than floated over the field, which is how it
                ended up sitting on top of the text it was meant to sit beside. */}
            <button
              onClick={close}
              aria-label="Close"
              className="shrink-0 w-11 h-11 flex items-center justify-center rounded-xl hover:bg-black/5 active:scale-95 transition-all"
            >
              <X className="w-5 h-5 text-black/40" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          {countries.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-black/40">
              No country matches “{searchTerm.trim()}”.
            </p>
          ) : (
            countries.map((country, index) => {
              const isSelected = country.dial_code === selectedCode;
              return (
                <button
                  key={`${country.code}-${country.dial_code}`}
                  onClick={() => handleSelect(country)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-black/[0.03] active:bg-black/[0.06] transition-colors ${
                    // A hairline under the pinned block, so it reads as a shortlist rather than
                    // as the alphabet mysteriously starting at Indonesia.
                    pinnedCount && index === pinnedCount - 1 ? 'border-b border-black/8' : ''
                  }`}
                >
                  {/* Fixed box: flag-icons renders 4:3, and without a width the rows jitter as
                      each sprite loads. */}
                  <span
                    className={`fi fi-${country.code.toLowerCase()} shrink-0 rounded-[3px]`}
                    style={{ width: 24, height: 18 }}
                  />
                  <span className="flex-1 min-w-0 truncate text-sm font-medium text-black/85">
                    {country.name}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-black/35">
                    {country.dial_code}
                  </span>
                  {isSelected && <Check className="shrink-0 w-4 h-4 text-black" />}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={`Country code, currently ${selectedCountry?.dial_code ?? selectedCode}`}
        className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-2 bg-black/[0.05] hover:bg-black/10 transition-colors rounded-lg px-3 py-2"
      >
        <span
          className={`fi fi-${selectedCountry?.code.toLowerCase()} rounded-[2px]`}
          style={{ width: 20, height: 15 }}
        />
        <span className="font-bold text-gray-700">{selectedCountry?.dial_code ?? selectedCode}</span>
      </button>

      {mounted && isOpen && createPortal(dialog, document.body)}
    </>
  );
}

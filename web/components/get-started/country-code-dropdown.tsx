"use client"

import { useState } from 'react';
import countryCodes from '@/lib/country-codes.json';
import { Search } from 'lucide-react';

interface Country {
  name: string;
  dial_code: string;
  code: string;
}

interface CountryCodeDropdownProps {
  onSelect: (dialCode: string) => void;
  selectedCode: string;
}

export default function CountryCodeDropdown({ onSelect, selectedCode }: CountryCodeDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const selectedCountry = countryCodes.find(c => c.dial_code === selectedCode);

  const filteredCountries = countryCodes.filter(country =>
    country.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    country.dial_code.includes(searchTerm)
  );

  const handleSelect = (country: Country) => {
    onSelect(country.dial_code);
    setIsOpen(false);
    setSearchTerm('');
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-2 bg-gray-100/50 hover:bg-gray-100 transition-colors rounded-lg px-3 py-2"
      >
        <span className={`fi fi-${selectedCountry?.code.toLowerCase()}`}></span>
        <span className="font-bold text-gray-700">{selectedCountry?.dial_code}</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm animate-in fade-in-20">
          <div className="w-full max-w-sm h-[80vh] bg-white rounded-2xl flex flex-col shadow-xl">
            <div className="p-4 border-b relative">
              <Search className="absolute left-8 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search country..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-50 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
                autoFocus
              />
               <button onClick={() => setIsOpen(false)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 font-bold p-2">&times;</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredCountries.map((country) => (
                <div
                  key={country.code}
                  onClick={() => handleSelect(country)}
                  className="flex items-center gap-4 px-6 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <span className={`fi fi-${country.code.toLowerCase()}`}></span>
                  <span className="flex-1 text-gray-800">{country.name}</span>
                  <span className="text-gray-400">{country.dial_code}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

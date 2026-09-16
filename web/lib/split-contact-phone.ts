/**
 * A contact's cached number is stored as one concatenated string — `${countryCode}${phone}`,
 * digits only, no `+` (see `hooks/useContacts.ts`). Filling a recipient form back in needs it
 * split into the two pieces `CountryCodeDropdown` and the phone input actually take.
 *
 * Matched against every known dial code, longest first — "+1" is a prefix of "+1242" (Bahamas),
 * so checking shortest-first would misattribute a Bahamas number to the US/Canada.
 */

import countryCodes from './country-codes.json' with { type: 'json' };

const DIAL_CODES = [...countryCodes]
  .map((c) => c.dial_code.replace('+', ''))
  .sort((a, b) => b.length - a.length);

export function splitContactPhone(fullNumber: string): { countryCode: string; phone: string } {
  for (const code of DIAL_CODES) {
    if (fullNumber.startsWith(code)) {
      return { countryCode: `+${code}`, phone: fullNumber.slice(code.length) };
    }
  }
  // No dial code matched (shouldn't happen for a number this app saved) — default to Indonesia
  // rather than guess wrong silently.
  return { countryCode: '+62', phone: fullNumber };
}

/** Normalize a number returned by the browser's device-contact picker for the recipient form. */
export function splitDeviceContactPhone(
  rawNumber: string,
  fallbackCountryCode: string
): { countryCode: string; phone: string } {
  const digits = rawNumber.replace(/\D/g, '');

  // A leading plus is the only reliable signal that the contact stored an international number.
  // Bare national numbers can start with another country's dial code by coincidence.
  if (rawNumber.trim().startsWith('+')) return splitContactPhone(digits);

  const countryCode = `+${fallbackCountryCode.replace(/\D/g, '')}`;
  const dialDigits = countryCode.slice(1);
  const phone = digits.startsWith(dialDigits) ? digits.slice(dialDigits.length) : digits;
  return { countryCode, phone };
}

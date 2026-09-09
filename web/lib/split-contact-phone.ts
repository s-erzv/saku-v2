/**
 * A contact's cached number is stored as one concatenated string — `${countryCode}${phone}`,
 * digits only, no `+` (see `hooks/useContacts.ts`). Filling a recipient form back in needs it
 * split into the two pieces `CountryCodeDropdown` and the phone input actually take.
 *
 * Matched against every known dial code, longest first — "+1" is a prefix of "+1242" (Bahamas),
 * so checking shortest-first would misattribute a Bahamas number to the US/Canada.
 */

import countryCodes from './country-codes.json';

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

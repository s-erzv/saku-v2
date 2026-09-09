/**
 * Regional Compliance Layer (PRD Section 6).
 *
 * The PRD's design principle, directly: compliance is a policy layer configurable per country —
 * which real disbursement partners a country may use, whether Travel Rule data would be needed,
 * whether off-ramp is even on — kept separate from the universal wallet logic. This module is
 * where that separation lives: nothing in `lib/escrow.ts`, `lib/xendit-disbursement.ts`, or the
 * offramp routes hardcodes a country's status; they all ask this module.
 *
 * `compliance_policies` itself predates this module — it was seeded 2026-09-06 in an earlier
 * session, ID enabled and every other PRD country disabled, but nothing ever read it. This file
 * is what actually wires it up; the per-country judgment calls in the seed data are treated as
 * authoritative and are not second-guessed here.
 *
 * `users.country_code` is deliberately not a foreign key to `compliance_policies` (a user in an
 * unseeded country must still be able to sign up), so "no row" is a real, expected state — it
 * means deny by absence, not a data-integrity error.
 */

import { getSupabaseAdmin } from './supabaseAdmin';

export interface CompliancePolicy {
  countryCode: string;
  countryName: string;
  offrampEnabled: boolean;
  travelRuleRequired: boolean;
  travelRuleThreshold: number | null;
  thresholdCurrency: string | null;
  cryptoAsPaymentAllowed: boolean;
  allowedPartnerIds: string[];
  regulator: string;
  notes: string;
}

function fromRow(row: {
  country_code: string;
  country_name: string;
  offramp_enabled: boolean;
  travel_rule_required: boolean;
  travel_rule_threshold: number | null;
  threshold_currency: string | null;
  crypto_as_payment_allowed: boolean;
  allowed_partner_ids: string[] | null;
  regulator: string;
  notes: string;
}): CompliancePolicy {
  return {
    countryCode: row.country_code,
    countryName: row.country_name,
    offrampEnabled: row.offramp_enabled,
    travelRuleRequired: row.travel_rule_required,
    travelRuleThreshold: row.travel_rule_threshold,
    thresholdCurrency: row.threshold_currency,
    cryptoAsPaymentAllowed: row.crypto_as_payment_allowed,
    allowedPartnerIds: row.allowed_partner_ids ?? [],
    regulator: row.regulator,
    notes: row.notes,
  };
}

/** Null means no policy exists for this country — the caller must treat that as "denied". */
export async function getCompliancePolicy(countryCode: string | null | undefined): Promise<CompliancePolicy | null> {
  const iso = (countryCode ?? '').toUpperCase();
  if (!iso) return null;

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('compliance_policies')
    .select('*')
    .eq('country_code', iso)
    .maybeSingle();

  return data ? fromRow(data) : null;
}

/** Whether the off-ramp is on for this country. Deny by absence: an unseeded country returns false. */
export function isOfframpAllowed(policy: CompliancePolicy | null): boolean {
  return policy?.offrampEnabled ?? false;
}

/**
 * What to tell the user when off-ramp is off where they are.
 *
 * `notes` is a regulatory memo written for whoever maintains this table — "Most mature ASEAN
 * framework. Not legal tender. Travel Rule in implementation." is an accurate summary of
 * Malaysia's position and completely useless to a Malaysian who just wanted to cash out. It
 * used to be piped straight to the screen. The user gets the country's name and a plain
 * sentence; the memo stays where it is useful, in the database and in `policy.notes` for
 * anyone reading the API.
 */
export function offrampDisabledMessage(policy: CompliancePolicy | null): string {
  const where = policy?.countryName ? `in ${policy.countryName}` : 'in your country';
  return `Cashing out to an e-wallet is not available ${where} yet. Everything else in Saku works as normal.`;
}

/** Whether `partner` (e.g. `'xendit'`) may be used for a real disbursement to this country. */
export function isPartnerAllowed(policy: CompliancePolicy | null, partner: string): boolean {
  return policy?.allowedPartnerIds.includes(partner) ?? false;
}

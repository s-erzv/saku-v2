/**
 * Service-role Supabase client for server routes.
 *
 * Every table except `compliance_policies` is RLS-on with no permissive policy, so the anon key
 * reads nothing. This client bypasses RLS, which means it must never be constructed in code
 * that can reach the browser — hence the runtime guard below.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

function assertServiceRoleKey(key: string): void {
  // A Supabase key is an unsigned-to-us JWT whose payload names the role. Pasting the anon key
  // into SUPABASE_SERVICE_ROLE_KEY is an easy mistake and would otherwise surface as every
  // query silently returning zero rows — RLS doing its job, looking like a logic bug.
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    if (payload.role !== 'service_role') {
      throw new Error(
        `SUPABASE_SERVICE_ROLE_KEY has role "${payload.role}", expected "service_role". ` +
          'Copy the service_role key from Settings > API, not the anon key.'
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('SUPABASE_SERVICE_ROLE_KEY')) throw error;
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not a readable Supabase key');
  }
}

export function getSupabaseAdmin(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error('getSupabaseAdmin() must never run in the browser');
  }
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');

  assertServiceRoleKey(key);

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

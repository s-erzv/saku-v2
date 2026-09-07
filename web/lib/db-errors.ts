/**
 * Turning a database failure into something a human can act on.
 *
 * The routes here `throw` PostgREST errors straight from supabase-js. Those are plain objects,
 * not `Error` instances, so the usual `error instanceof Error ? error.message : 'generic'`
 * pattern silently discards them — a missing column arrives in the browser as a bare 500 with
 * nothing to go on. That cost real debugging time, so the shape is handled explicitly.
 */

/** PostgREST / Postgres codes that mean "the database does not have what the code expects". */
const SCHEMA_DRIFT_CODES = new Set([
  'PGRST204', // column not found in the schema cache
  'PGRST205', // table not found in the schema cache
  '42703', // undefined_column
  '42P01', // undefined_table
]);

interface PostgrestLike {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

function asPostgrest(error: unknown): PostgrestLike | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as PostgrestLike;
  return typeof candidate.message === 'string' || typeof candidate.code === 'string'
    ? candidate
    : null;
}

export interface DbErrorInfo {
  /** Safe to return to the caller: it describes the server's own misconfiguration, not user data. */
  message: string;
  /** True when the fix is a migration, not a code change. */
  isSchemaDrift: boolean;
  code?: string;
}

export function describeDbError(error: unknown, fallback: string): DbErrorInfo {
  const pg = asPostgrest(error);

  if (pg && pg.code && SCHEMA_DRIFT_CODES.has(pg.code)) {
    return {
      // Names the pending migration, because that is always the fix for this class of error and
      // "500" gives whoever hits it no way to know that.
      message: `Database schema is out of date: ${pg.message ?? pg.code}. Run the pending migration in supabase/schema/.`,
      isSchemaDrift: true,
      code: pg.code,
    };
  }

  if (pg?.message) {
    return { message: pg.message, isSchemaDrift: false, code: pg.code };
  }

  if (error instanceof Error) {
    return { message: error.message, isSchemaDrift: false };
  }

  return { message: fallback, isSchemaDrift: false };
}

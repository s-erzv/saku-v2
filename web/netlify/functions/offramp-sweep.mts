/**
 * The clock behind `POST /api/offramp/sweep`.
 *
 * Netlify runs this on the schedule in `config` below and nothing else can: a scheduled function
 * has no public URL in production. All it does is call the route that holds the actual logic, with
 * the shared secret — see that route for why the work is not inlined here (it needs the app's
 * database client, env and path aliases, none of which this runtime has).
 *
 * Required environment variables, both set on the Netlify site, not in the repo:
 *   - `OFFRAMP_SWEEP_TOKEN` — the same value the route checks. Generate it once; any long random
 *     string will do.
 *   - `NEXT_PUBLIC_APP_URL` — already set for verification links (`lib/app-url.ts`). `URL`, which
 *     Netlify provides, is the fallback.
 *
 * Ten minutes, not one: the rate lock is 30-120 seconds, so nothing here is urgent by the time it
 * is eligible, and a refund the user triggers themselves still happens immediately. Netlify caps a
 * scheduled function at 30 seconds, which is why the route handles a bounded batch and leaves the
 * rest to the next run.
 *
 * Failures are intentionally loud and nothing more. There is no retry: the requests stay expired,
 * so the next run picks them up.
 */

const sweep = async () => {
  const token = process.env.OFFRAMP_SWEEP_TOKEN?.trim();
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.URL)?.trim().replace(/\/+$/, '');

  if (!token || !base) {
    // Not thrown: a missing variable is a configuration problem that a stack trace does not help
    // with, and the route refuses unauthenticated calls anyway.
    console.error(
      '[offramp-sweep] not configured —',
      `OFFRAMP_SWEEP_TOKEN ${token ? 'set' : 'missing'},`,
      `site URL ${base ? 'set' : 'missing'}`
    );
    return;
  }

  const response = await fetch(`${base}/api/offramp/sweep`, {
    method: 'POST',
    headers: { 'x-sweep-token': token },
  });

  const body = await response.text();

  if (!response.ok) {
    console.error(`[offramp-sweep] route answered ${response.status}:`, body.slice(0, 500));
    return;
  }

  // The summary the route returns — scanned/refunded/reconciled/skipped/failed — is the run log.
  console.log('[offramp-sweep]', body.slice(0, 2000));
};

export default sweep;

export const config = {
  // Every ten minutes, in UTC. Netlify's scheduled functions only fire on published deploys.
  schedule: '*/10 * * * *',
};

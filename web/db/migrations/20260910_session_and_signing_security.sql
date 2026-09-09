-- Saku — session revocation, signing audit, spending cap, and durable rate limiting.
--
-- Run this once against the project database before deploying the matching code. It is additive:
-- no column is dropped and no existing row is rewritten.
--
-- One visible effect on rollout: every session issued before this migration is invalidated,
-- because tokens minted by the old code carry no `ver` claim and the new verifier refuses a token
-- without one. Everyone signs in again, once. That is the intended behaviour, not a side effect —
-- the old tokens are exactly the ones with no revocation path.

begin;

-- ---------------------------------------------------------------------------
-- 1. Session revocation
-- ---------------------------------------------------------------------------
-- Every session token carries this number. `lib/session.ts` compares it on every request, so
-- bumping it here kills every token ever issued to that user, immediately and everywhere.
-- Signing out bumps it; so should any future "sign out of all devices" or account-recovery flow.
alter table public.users
  add column if not exists token_version integer not null default 0;

-- ---------------------------------------------------------------------------
-- 2. Signing audit trail + the ledger the daily cap reads
-- ---------------------------------------------------------------------------
-- Written for refusals as well as successes: a burst of refusals is the signal that someone is
-- probing a session, and it is worth more than the successes it sits next to.
create table if not exists public.signing_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  wallet_address text,
  contract       text,
  method         text,
  to_address     text,
  counterparty   text,
  -- USDC leaving the wallet, in base units (6 dp). `numeric` because base units pass 2^53 at
  -- around nine billion USDC, and a float would start rounding silently well before that.
  usdc_out       numeric(78, 0) not null default 0,
  outcome        text not null check (outcome in ('signed', 'refused', 'failed')),
  detail         text,
  ip             text,
  user_agent     text,
  created_at     timestamptz not null default now()
);

-- The daily-cap query: one user, recent, signed only.
create index if not exists signing_events_user_recent_idx
  on public.signing_events (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Durable rate limiting
-- ---------------------------------------------------------------------------
-- Replaces the in-process Map in `lib/rate-limiter.ts`, which on serverless meant a fresh, empty
-- limit for every cold start and no sharing between concurrent instances — that is to say, on the
-- signing endpoint, no limit at all.
create table if not exists public.rate_limit_buckets (
  bucket       text primary key,
  window_start timestamptz not null default now(),
  count        integer not null default 0
);

create index if not exists rate_limit_buckets_window_idx
  on public.rate_limit_buckets (window_start);

-- One statement, so two concurrent requests cannot both read "0" and both write "1". The whole
-- point of moving off the in-memory limiter is lost if the replacement races.
create or replace function public.saku_rate_limit_hit(
  p_bucket    text,
  p_window_ms bigint,
  p_max       integer
)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now          timestamptz := now();
  v_window       interval := make_interval(secs => p_window_ms / 1000.0);
  v_window_start timestamptz;
  v_count        integer;
begin
  insert into public.rate_limit_buckets as b (bucket, window_start, count)
  values (p_bucket, v_now, 1)
  on conflict (bucket) do update
    set window_start = case
          when b.window_start < v_now - v_window then v_now
          else b.window_start
        end,
        count = case
          when b.window_start < v_now - v_window then 1
          else b.count + 1
        end
  returning b.window_start, b.count into v_window_start, v_count;

  return query
    select v_count <= p_max,
           greatest(0, p_max - v_count),
           v_window_start + v_window;
end;
$$;

-- Housekeeping. Buckets are disposable; anything older than a day is dead weight. Schedule this
-- with pg_cron if it is available, or run it from a periodic job:
--   delete from public.rate_limit_buckets where window_start < now() - interval '1 day';

-- ---------------------------------------------------------------------------
-- 4. Lock both new tables down
-- ---------------------------------------------------------------------------
-- Same posture as every other table in this schema: RLS on, no permissive policy, so the anon key
-- reads nothing and only the service-role client used by API routes can touch them.
alter table public.signing_events    enable row level security;
alter table public.rate_limit_buckets enable row level security;

revoke all on public.signing_events    from anon, authenticated;
revoke all on public.rate_limit_buckets from anon, authenticated;
revoke all on function public.saku_rate_limit_hit(text, bigint, integer) from anon, authenticated;

commit;

-- ---------------------------------------------------------------------------
-- 5. Auth audit trail (added alongside the above; see lib/audit-log.ts)
-- ---------------------------------------------------------------------------
-- The trail for access, kept separate from `signing_events`: this one records who got in and who
-- failed to, and deliberately holds no amounts, addresses or counterparties.
--
-- `phone_hash`, never a phone number. The module this replaces wrote plain numbers to a
-- `phone_number` column, which would have made a rarely-read, long-lived table the one place a
-- database dump yields a contact list.
begin;

create table if not exists public.auth_events (
  id         uuid primary key default gen_random_uuid(),
  event_type text not null,
  phone_hash text,
  user_id    uuid references public.users(id) on delete set null,
  ip         text,
  user_agent text,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- "What has been happening to this number lately?" is the question this table exists to answer.
create index if not exists auth_events_phone_recent_idx
  on public.auth_events (phone_hash, created_at desc);
create index if not exists auth_events_user_recent_idx
  on public.auth_events (user_id, created_at desc);

alter table public.auth_events enable row level security;
revoke all on public.auth_events from anon, authenticated;

commit;

#!/usr/bin/env bash
# Runs scripts/verify-tx-policy.ts against the real lib/tx-policy.ts.
#
# The one thing standing in the way of `node scripts/verify-tx-policy.ts` is the `@/lib/chain`
# import: it is a bundler alias, and node has never heard of it. Rather than reshape production
# code around a test, this writes a copy with that single line rewritten to read the same env var
# the alias target reads, runs the check against it, and deletes it. Everything else in the file —
# every rule that decides what gets signed — is byte-for-byte what ships.
set -euo pipefail

cd "$(dirname "$0")/.."
GENERATED="scripts/.tx-policy.generated.ts"
trap 'rm -f "$GENERATED"' EXIT

sed "s|import { CHAIN_ID } from '@/lib/chain';|const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 97);|" \
  lib/tx-policy.ts > "$GENERATED"

if ! grep -q 'const CHAIN_ID = Number' "$GENERATED"; then
  echo "verify-tx-policy: lib/tx-policy.ts no longer imports CHAIN_ID the way this script expects." >&2
  echo "Update the sed in scripts/verify-tx-policy.sh before trusting a pass." >&2
  exit 2
fi

node --env-file-if-exists=.env.local --experimental-strip-types scripts/verify-tx-policy.ts

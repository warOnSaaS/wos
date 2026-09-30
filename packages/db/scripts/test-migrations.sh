#!/usr/bin/env bash
# Applies every migration to a throwaway Postgres in Docker and runs test/db-assertions.sql.
# Usage: bash packages/db/scripts/test-migrations.sh [image]
#   default image postgres:17-alpine; Supabase parity: public.ecr.aws/supabase/postgres:17.4.1.048
set -euo pipefail
IMAGE="${1:-postgres:17-alpine}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
NAME="wos-migrations-test-$$"
# On Supabase images `postgres` is not a superuser and can only create schemas in the `postgres`
# database, exactly like a hosted Supabase project; use that database there.
DB=wos
case "$IMAGE" in *supabase*) DB=postgres ;; esac
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
[ -n "${KEEP:-}" ] || trap cleanup EXIT

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test -e POSTGRES_DB="$DB" "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U postgres -d "$DB" >/dev/null 2>&1; then break; fi
  sleep 1
done
# Supabase images restart once after their init scripts; wait until the server stays up.
case "$IMAGE" in *supabase*) sleep 15; until docker exec "$NAME" pg_isready -U postgres -d "$DB" >/dev/null 2>&1; do sleep 1; done ;; *) sleep 2 ;; esac

PSQL=(docker exec -i "$NAME" psql -v ON_ERROR_STOP=1 -q -U postgres -d "$DB")
for f in "$HERE"/migrations/*.sql; do
  echo "apply $(basename "$f")"
  "${PSQL[@]}" --single-transaction < "$f"
done
echo "re-apply 0000_meta.sql (must be idempotent)"
"${PSQL[@]}" --single-transaction < "$HERE/migrations/0000_meta.sql"

echo "assertions"
"${PSQL[@]}" < "$HERE/test/db-assertions.sql"
echo "0010 assertions (D61, D60 delta, D63)"
"${PSQL[@]}" < "$HERE/test/bugs-assertions.sql"
echo "concurrency"
bash "$HERE/test/concurrency.sh" "$NAME" "$DB"
echo "accounting-projection trace (engine vs database; reviews 06, 07)"
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)' \
  || { echo "the accounting trace needs Node >= 22.18 (nvm use 22)" >&2; exit 1; }
node --experimental-strip-types --no-warnings "$HERE/test/accounting-trace.mjs" | docker exec -i "$NAME" psql -v ON_ERROR_STOP=1 -q -U postgres -d "$DB"
echo "db tests passed on $IMAGE"

#!/usr/bin/env bash
# Astra review 09, Appendix B q1.mjs, run against real Postgres instead of PGlite: the Q1 functions and triggers are
# extracted unchanged from migration 0010 (from check_claim_snapshot to the RLS section) into minimal fixture tables.
#   bash tools/astra-09/q1.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="wos-astra09-q1-$$"
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=test postgres:17-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
until docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done; sleep 2
P=(docker exec -i "$NAME" psql -v ON_ERROR_STOP=0 -q -t -A -U postgres)
"${P[@]}" -c "create schema wos; create table wos.run_policy_snapshots(lease_id uuid, body jsonb); create table wos.contribution_receipts(id uuid,task_id uuid,lease_id uuid); create table wos.task_budgets(task_id uuid,reserved_base bigint); create table wos.allocations(receipt_id uuid,amount_base bigint);"
awk '/create or replace function wos.check_claim_snapshot\(\)/{f=1} /-- Append-only, grants, RLS/{f=0} f' "$ROOT/packages/db/migrations/0010_bugs_and_maintenance.sql" | sed '/^-- =*$/d' | "${P[@]}"
i=0
for c in '{"claim":{"mode":"self_pick","queueBonusBp":2000,"bonusApplies":false}}|1200' '{}|1200' '{"claim":{"mode":"self_pick","queueBonusBp":0,"bonusApplies":false}}|1200' '{"claim":{"mode":"self_pick","queueBonusBp":2000,"bonusApplies":false}}|1000' '{"claim":{"mode":"self_pick","queueBonusBp":2000,"bonusApplies":false}}|999'; do
  i=$((i+1)); body="${c%|*}"; amt="${c#*|}"; id="00000000-0000-4000-8000-$(printf '%012d' $i)"
  out=$("${P[@]}" 2>&1 <<SQL
insert into wos.task_budgets values('$id',1200); insert into wos.run_policy_snapshots values('$id','$body'); insert into wos.contribution_receipts values('$id','$id','$id');
begin; insert into wos.allocations values('$id',$amt); commit;
SQL
)
  if echo "$out" | grep -q ERROR; then echo "{\"i\":$i,\"body\":$body,\"amount\":$amt,\"accepted\":false,\"error\":\"$(echo "$out" | grep ERROR | sed 's/.*ERROR: *//' | head -1)\"}"; else echo "{\"i\":$i,\"body\":$body,\"amount\":$amt,\"accepted\":true}"; fi
done

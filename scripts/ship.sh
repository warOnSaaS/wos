#!/usr/bin/env bash
# wOS ship gate (D7; ARCHITECTURE.md section 10). Owner: verification workstream.
#
# The ONLY way production is migrated and deployed. In order, it refuses when:
#   1. the working tree is dirty (tracked changes or untracked files);
#   2. HEAD is not the tip of the ship branch (default main);
#   3. HEAD is not exactly what the remote has (unpushed, or behind);
#   4. the HEAD commit author is not `adventurini <anthonydventurini@gmail.com>` (Vercel blocks others);
#   5. CI on HEAD is not green: every required check present, completed and successful, none red;
#   6. DATABASE_MIGRATION_URL is not set.
# Then it lists pending migrations with the ledgered runner (@waronsaas/db runMigrations, checkOnly),
# applies them, and deploys. Any failure stops everything after it. Nothing migrates production by hand.
#
# Usage: scripts/ship.sh [--dry-run]    (--dry-run: every refusal and the migration check, no apply, no deploy)
#
# Test seams (each prints a warning when set; never set them for a real ship):
#   WOS_SHIP_CI_CMD       prints GitHub check-runs JSON for the sha in $WOS_SHIP_SHA
#   WOS_SHIP_MIGRATE_CMD  called as `<cmd> check` then `<cmd> apply`
#   WOS_SHIP_DEPLOY_CMD   called once to deploy
# Configuration: WOS_SHIP_BRANCH (main), WOS_SHIP_REMOTE (origin), WOS_SHIP_REPO (waronsaas/waronsaas),
#   WOS_SHIP_REQUIRED_CHECKS ('|'-separated check-run names; default: the jobs of .github/workflows/ci.yml).
set -euo pipefail

REQUIRED_AUTHOR="adventurini <anthonydventurini@gmail.com>"
BRANCH="${WOS_SHIP_BRANCH:-main}"
REMOTE="${WOS_SHIP_REMOTE:-origin}"
REPO="${WOS_SHIP_REPO:-waronsaas/waronsaas}"
REQUIRED_CHECKS="${WOS_SHIP_REQUIRED_CHECKS:-typecheck, lint, test|db:test|adversarial db suite}"
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "usage: scripts/ship.sh [--dry-run]" >&2; exit 2 ;;
  esac
done

refuse() { echo "ship: REFUSED: $*" >&2; exit 1; }
step() { echo "ship: $*"; }
for seam in WOS_SHIP_CI_CMD WOS_SHIP_MIGRATE_CMD WOS_SHIP_DEPLOY_CMD; do
  if [ -n "${!seam:-}" ]; then echo "ship: WARNING: $seam is overridden; this is a test run, not a real ship" >&2; fi
done

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || refuse "not inside a git repository"
cd "$ROOT"

# 1. clean tree (untracked files count: they could be built or deployed)
if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  git status --short >&2
  refuse "working tree is dirty; commit or remove the changes above"
fi

# 2. on the ship branch
CURRENT="$(git symbolic-ref --quiet --short HEAD || true)"
[ "$CURRENT" = "$BRANCH" ] || refuse "HEAD is ${CURRENT:-detached}, not $BRANCH"

# 3. exactly what the remote has
git fetch --quiet "$REMOTE" "$BRANCH" || refuse "cannot fetch $REMOTE/$BRANCH"
SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "$REMOTE/$BRANCH" 2>/dev/null)" || refuse "$REMOTE/$BRANCH does not exist; push first"
if [ "$SHA" != "$REMOTE_SHA" ]; then
  if git merge-base --is-ancestor "$SHA" "$REMOTE_SHA"; then refuse "HEAD $SHA is behind $REMOTE/$BRANCH ($REMOTE_SHA); pull first"; fi
  refuse "HEAD $SHA is not pushed to $REMOTE/$BRANCH ($REMOTE_SHA)"
fi

# 4. author (Vercel refuses deploys whose HEAD author is not a project member)
AUTHOR="$(git log -1 --format='%an <%ae>' HEAD)"
[ "$AUTHOR" = "$REQUIRED_AUTHOR" ] || refuse "HEAD author is '$AUTHOR', must be '$REQUIRED_AUTHOR'"

# 5. CI green on exactly this sha (fail closed: no data, pending, missing or red all refuse)
step "checking CI on $SHA"
if [ -n "${WOS_SHIP_CI_CMD:-}" ]; then
  CI_JSON="$(WOS_SHIP_SHA="$SHA" bash -c "$WOS_SHIP_CI_CMD")" || refuse "CI status command failed"
else
  command -v gh >/dev/null || refuse "gh CLI not found; cannot read CI status"
  CI_JSON="$(gh api "repos/$REPO/commits/$SHA/check-runs?per_page=100")" || refuse "cannot read CI status from GitHub"
fi
CI_VERDICT="$(printf '%s' "$CI_JSON" | SHA="$SHA" REQUIRED="$REQUIRED_CHECKS" node -e '
  let raw = ""; process.stdin.on("data", (d) => (raw += d)).on("end", () => {
    let runs;
    try { runs = JSON.parse(raw).check_runs; } catch { console.log("unreadable CI status"); return; }
    if (!Array.isArray(runs)) { console.log("no check_runs in CI status"); return; }
    runs = runs.filter((r) => r.head_sha === process.env.SHA);
    const problems = [];
    for (const name of process.env.REQUIRED.split("|").filter(Boolean)) {
      const mine = runs.filter((r) => r.name === name);
      if (mine.length === 0) problems.push(`missing ${name}`);
      for (const r of mine) if (r.status !== "completed" || r.conclusion !== "success") problems.push(`${name} is ${r.status}/${r.conclusion}`);
    }
    for (const r of runs) if (["failure", "cancelled", "timed_out", "action_required", "stale", "startup_failure"].includes(r.conclusion)) problems.push(`${r.name} is ${r.conclusion}`);
    console.log(problems.length ? [...new Set(problems)].join("; ") : "green");
  });')"
[ "$CI_VERDICT" = "green" ] || refuse "CI on $SHA is not green: $CI_VERDICT"

# 6. migrations with the ledgered runner, then deploy
[ -n "${DATABASE_MIGRATION_URL:-}" ] || refuse "DATABASE_MIGRATION_URL is not set (session pooler or direct URL as postgres)"

migrate() {
  if [ -n "${WOS_SHIP_MIGRATE_CMD:-}" ]; then
    bash -c "$WOS_SHIP_MIGRATE_CMD $1"
  else
    MODE="$1" node --input-type=module -e '
      import { runMigrations } from "@waronsaas/db";
      const checkOnly = process.env.MODE === "check";
      try {
        const r = await runMigrations({ databaseUrl: process.env.DATABASE_MIGRATION_URL, migrationsDir: "packages/db/migrations", checkOnly });
        console.log(`ship: migrations ${checkOnly ? "pending" : "applied"}: ${(checkOnly ? r.pending : r.applied).join(", ") || "none"}`);
      } catch (e) { console.error(`ship: migration runner: ${e.message}`); process.exit(1); }'
  fi
}

if [ -z "${WOS_SHIP_MIGRATE_CMD:-}" ]; then
  step "building (the runner ships in packages/db/dist)"
  npm run --silent build >/dev/null || refuse "build failed"
fi
step "listing pending migrations"
migrate check || refuse "migration check failed (edited or deleted migration, or runner error)"

if [ "$DRY_RUN" = 1 ]; then
  step "dry run: stopping before applying migrations and deploying $SHA"
  exit 0
fi

step "applying migrations"
migrate apply || refuse "migrations failed; nothing deployed"

step "deploying $SHA"
if [ -n "${WOS_SHIP_DEPLOY_CMD:-}" ]; then
  bash -c "$WOS_SHIP_DEPLOY_CMD" || refuse "deploy failed (migrations were applied)"
else
  command -v vercel >/dev/null || refuse "vercel CLI not found (migrations were applied)"
  vercel deploy --prod --yes --cwd services/control-plane || refuse "deploy failed (migrations were applied)"
fi
step "shipped $SHA"

#!/usr/bin/env bash
# Local equivalent of .github/workflows/ci.yml, run while GitHub Actions is blocked by account billing.
# It runs from a clean clone of HEAD, so uncommitted files cannot affect the result.
# Usage: scripts/ci-local.sh <postgres-url-for-tests> [log-file]
# Needs Node 24.13+, Docker, and a disposable PostgreSQL 16 (for example: docker run -d --name caveat-pg-test
#   -e POSTGRES_PASSWORD=ci-only -e POSTGRES_DB=caveat -p 55433:5432 postgres:16-alpine).
set -euo pipefail
PG_URL="${1:?postgres url}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${2:-$REPO/docs/evidence/local-ci.log}"
WORK="$(mktemp -d)"
trap 'docker rm -f caveat-ci-smoke >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

step() { printf '\n=== %s (%s)\n' "$1" "$(date -u +%H:%M:%SZ)"; }
{
  echo "CAVEAT local CI: equivalent of .github/workflows/ci.yml"
  echo "commit: $(git -C "$REPO" rev-parse HEAD)"
  echo "date:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "node:   $(node --version), npm $(npm --version), docker $(docker version --format '{{.Server.Version}}' 2>/dev/null)"
  git clone -q "$REPO" "$WORK/caveat" && cd "$WORK/caveat"

  step "job test: npm ci";                 npm ci --no-audit --no-fund
  step "job test: typecheck";              npm run typecheck
  step "job test: build";                  npm run build
  step "job test: tests on SQLite";        npm test
  step "job test: tests on PostgreSQL 16"; CAVEAT_TEST_DATABASE_URL="$PG_URL" npm test
  step "job test: browser tests";          npx playwright install chromium >/dev/null && npm run test:e2e
  step "job test: dependency audit";       npm audit --omit=dev --audit-level=high

  step "job docker: build";                docker build -q -t caveat:ci .
  step "job docker: smoke"
  docker run -d --name caveat-ci-smoke -p 3399:3000 caveat:ci >/dev/null
  ok=0
  for _ in $(seq 1 30); do
    if curl -fs http://127.0.0.1:3399/api/health && curl -fs http://127.0.0.1:3399/ | grep -q CAVEAT; then ok=1; break; fi
    sleep 1
  done
  [ "$ok" = 1 ] || { docker logs caveat-ci-smoke; exit 1; }
  echo; step "RESULT: all jobs passed"
} 2>&1 | tee "$LOG"

#!/usr/bin/env bash
# HYPER QUESTION BANK — Cloud Agent start phase.
# Runs on every boot. Brings up the Docker daemon and the Supabase local stack,
# ensures a usable dev staff account, and writes .env.local for the dev server.
# Must be idempotent and must return (the Vite dev server runs as a terminal).
set -euo pipefail

# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

cd "$REPO_ROOT"

# Toolchain may already be baked into the snapshot; these are no-ops if so.
ensure_system_packages
ensure_supabase_cli

if bring_up_backend; then
  log "Backend ready — Supabase API on http://localhost:54321, Studio on http://localhost:54323"
  log "Dev login: ${DEV_EMAIL} / ${DEV_PASSWORD}"
else
  log "WARNING: could not start the Docker/Supabase backend in this pod."
  log "The Vite dev server will still run, but the app will show its"
  log "'Supabase not configured' state (login and data are unavailable)."
fi

log "Start phase complete — 'vite-dev' terminal will serve http://localhost:5173"

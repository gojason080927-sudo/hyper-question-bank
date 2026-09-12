#!/usr/bin/env bash
# HYPER QUESTION BANK — Cloud Agent install phase.
# Idempotent, one-time (per environment build) repository + toolchain setup.
# Heavy/durable work belongs here so it is captured in the environment snapshot;
# per-boot service startup lives in start.sh.
set -euo pipefail

# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

cd "$REPO_ROOT"

log "Installing frontend dependencies (npm ci)"
npm ci

# System deps + CLIs are best-effort: the frontend (npm) baseline must always
# succeed even if this pod cannot run a nested Docker daemon.
ensure_system_packages || log "WARNING: system package install failed"
ensure_supabase_cli || log "WARNING: Supabase CLI install failed"

# Pre-pull the Supabase container images (~2GB) so future boots start quickly.
# The images are baked into the environment snapshot. We then tear the stack
# back down (keeping images cached) — start.sh brings it up on each boot.
if ensure_dockerd; then
  log "Pre-pulling Supabase images (cached into the snapshot)"
  supabase start --workdir "$REPO_ROOT" >/dev/null 2>&1 \
    || log "Supabase pre-pull did not fully start; images are still cached"
  supabase stop --workdir "$REPO_ROOT" --no-backup >/dev/null 2>&1 || true
else
  log "WARNING: Docker daemon unavailable in build pod; skipping image pre-pull."
  log "start.sh will attempt Docker/Supabase on each boot and degrade gracefully."
fi

log "Install phase complete"

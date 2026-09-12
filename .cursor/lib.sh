#!/usr/bin/env bash
# Shared helpers for the HYPER QUESTION BANK Cloud Agent environment.
# Sourced by install.sh and start.sh. All functions are idempotent.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUPABASE_PROJECT="$(grep -E '^project_id' "$REPO_ROOT/supabase/config.toml" | head -1 | cut -d'"' -f2)"
DB_CONTAINER="supabase_db_${SUPABASE_PROJECT}"
DEV_EMAIL="teacher@example.com"
DEV_PASSWORD="password123"
DEV_DISPLAY_NAME="개발 강사"

log() { echo "[hqb-env] $*"; }

# --- system packages -------------------------------------------------------
ensure_system_packages() {
  if command -v docker >/dev/null 2>&1 && command -v fuse-overlayfs >/dev/null 2>&1; then
    return 0
  fi
  log "Installing system packages (docker, fuse-overlayfs, iptables)"
  export DEBIAN_FRONTEND=noninteractive
  sudo apt-get update -qq
  # Keep any pre-existing conffiles to stay non-interactive.
  sudo apt-get install -y -qq -o Dpkg::Options::=--force-confold \
    docker.io docker-compose-v2 fuse-overlayfs uidmap iptables
  # Some fuse packages can land half-configured; finish them non-interactively.
  sudo dpkg --configure -a || true
}

ensure_supabase_cli() {
  if command -v supabase >/dev/null 2>&1; then
    return 0
  fi
  log "Installing Supabase CLI"
  local ver deb
  ver="$(curl -fsSL https://api.github.com/repos/supabase/cli/releases/latest \
    | grep -oP '"tag_name":\s*"v\K[^"]+')"
  deb="/tmp/supabase_${ver}.deb"
  curl -fsSL -o "$deb" \
    "https://github.com/supabase/cli/releases/download/v${ver}/supabase_${ver}_linux_amd64.deb"
  sudo dpkg -i "$deb"
}

# --- docker daemon ---------------------------------------------------------
_docker_ready() { docker info >/dev/null 2>&1; }

_wait_for_docker() {
  local tries="${1:-30}"
  for _ in $(seq 1 "$tries"); do
    if _docker_ready; then return 0; fi
    sleep 1
  done
  return 1
}

_start_dockerd_with() {
  local driver="$1"
  log "Starting dockerd (storage-driver=${driver})"
  sudo bash -c "setsid dockerd --storage-driver=${driver} \
    >/tmp/hqb-dockerd.log 2>&1 < /dev/null &"
  sleep 2
  # dockerd owns the socket as root:docker; make it usable by this user.
  for _ in $(seq 1 10); do
    [ -S /var/run/docker.sock ] && break
    sleep 1
  done
  sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
}

ensure_dockerd() {
  if _docker_ready; then
    sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
    return 0
  fi
  # overlay2 is fastest and works in this nested VM; fall back to fuse-overlayfs.
  _start_dockerd_with overlay2
  if ! _wait_for_docker 30; then
    log "overlay2 dockerd did not become ready; retrying with fuse-overlayfs"
    sudo pkill -x dockerd 2>/dev/null || true
    sleep 3
    _start_dockerd_with fuse-overlayfs
    _wait_for_docker 40 || { log "dockerd failed to start"; cat /tmp/hqb-dockerd.log || true; return 1; }
  fi
  sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
  # Same-network container-to-container TCP is dropped when bridged frames pass
  # through the (legacy/nft mixed) iptables FORWARD path in this nested VM.
  # Let bridged traffic flow at L2 so Supabase's inter-container calls work.
  sudo modprobe br_netfilter 2>/dev/null || true
  sudo sysctl -w net.bridge.bridge-nf-call-iptables=0 >/dev/null 2>&1 || true
  sudo sysctl -w net.bridge.bridge-nf-call-ip6tables=0 >/dev/null 2>&1 || true
  log "dockerd ready"
}

# --- supabase local stack --------------------------------------------------
# The committed config.toml disables the local email auth provider
# (GOTRUE_EXTERNAL_EMAIL_ENABLED=false) because public signup is closed.
# For local development we still need password login to work, so enable the
# email provider in the local config only. We mark the file skip-worktree so
# this dev-only change never shows up in git status or gets committed.
enable_local_email_login() {
  local cfg="$REPO_ROOT/supabase/config.toml"
  if ! grep -qzoP '\[auth\.email\]\n# Allow/disallow new user signups via email to your project\.\nenable_signup = true' "$cfg"; then
    log "Enabling local email auth provider (dev-only, skip-worktree)"
    python3 - "$cfg" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
needle = ("[auth.email]\n"
          "# Allow/disallow new user signups via email to your project.\n"
          "enable_signup = false")
repl = ("[auth.email]\n"
        "# Allow/disallow new user signups via email to your project.\n"
        "enable_signup = true")
if needle in s:
    s = s.replace(needle, repl, 1)
    open(p, "w").write(s)
PY
  fi
  git -C "$REPO_ROOT" update-index --skip-worktree supabase/config.toml 2>/dev/null || true
}

ensure_supabase_up() {
  if supabase status --workdir "$REPO_ROOT" >/dev/null 2>&1; then
    log "Supabase stack already running"
    return 0
  fi
  log "Starting Supabase local stack (applies migrations + seed)"
  supabase start --workdir "$REPO_ROOT"
}

# Create (idempotently) a confirmed staff account so the app can be used.
ensure_dev_user() {
  local env svc anon api
  env="$(supabase status --workdir "$REPO_ROOT" -o env 2>/dev/null)"
  svc="$(sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p' <<<"$env")"
  anon="$(sed -n 's/^ANON_KEY="\(.*\)"$/\1/p' <<<"$env")"
  api="$(sed -n 's/^API_URL="\(.*\)"$/\1/p' <<<"$env")"

  local exists
  exists="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tAc \
    "select 1 from auth.users where email='${DEV_EMAIL}' limit 1" 2>/dev/null || true)"
  if [ "$exists" != "1" ]; then
    log "Creating dev staff user ${DEV_EMAIL}"
    curl -fsS -X POST "${api}/auth/v1/admin/users" \
      -H "apikey: ${svc}" -H "Authorization: Bearer ${svc}" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"${DEV_EMAIL}\",\"password\":\"${DEV_PASSWORD}\",\"email_confirm\":true}" \
      >/dev/null
  fi

  # GoTrue cannot scan NULL token columns on admin-created users; normalize them,
  # and promote the auto-created (PENDING) profile to ADMIN so the app is usable.
  # `-i` is required so the heredoc is forwarded to psql's stdin; without it
  # docker exec runs psql with empty input and the SQL silently no-ops.
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL >/dev/null
UPDATE auth.users SET
  confirmation_token        = coalesce(confirmation_token, ''),
  email_change              = coalesce(email_change, ''),
  email_change_token_new    = coalesce(email_change_token_new, ''),
  email_change_token_current= coalesce(email_change_token_current, ''),
  recovery_token            = coalesce(recovery_token, ''),
  phone_change              = coalesce(phone_change, ''),
  phone_change_token        = coalesce(phone_change_token, ''),
  reauthentication_token    = coalesce(reauthentication_token, '')
WHERE email = '${DEV_EMAIL}';

INSERT INTO public.user_profiles (user_id, role, display_name)
SELECT id, 'ADMIN', '${DEV_DISPLAY_NAME}' FROM auth.users WHERE email = '${DEV_EMAIL}'
ON CONFLICT (user_id) DO UPDATE SET role = 'ADMIN', display_name = '${DEV_DISPLAY_NAME}';
SQL
  log "Dev staff user ready (${DEV_EMAIL} / ${DEV_PASSWORD}, role ADMIN)"

  # Expose the public URL + anon key to the Vite dev server.
  cat > "$REPO_ROOT/.env.local" <<ENV
# Auto-generated by .cursor/start.sh for local development against the
# local Supabase stack. Gitignored. Do not commit real secrets here.
VITE_SUPABASE_URL=${api}
VITE_SUPABASE_ANON_KEY=${anon}
ENV
  log "Wrote .env.local (VITE_SUPABASE_URL=${api})"
}

# Bring up the whole local backend (Docker + Supabase + dev account).
# Returns non-zero (without aborting the caller) if the nested Docker daemon
# cannot start, so the frontend can still run in a database-less mode.
bring_up_backend() {
  ensure_dockerd || return 1
  enable_local_email_login || return 1
  ensure_supabase_up || return 1
  ensure_dev_user || return 1
  return 0
}

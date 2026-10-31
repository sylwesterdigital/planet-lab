#!/usr/bin/env bash
# Planet Lab versioned release installer. Code and Python environments live in /opt, not webroot.
set -Eeuo pipefail
umask 022
VERSION="${1:?version}"; ACTION="${2:-activate}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid version'; exit 2; }
APPROOT=/opt/planetlab
RELEASE="$APPROOT/releases/v$VERSION"
VENV_ROOT="$APPROOT/venvs"
DATA=/var/lib/planetlab
ENV=/etc/planetlab/planetlab.env
SITE=/etc/nginx/sites-available/planetlab.me
SERVICE=/etc/systemd/system/planetlab.service
STATE=/etc/planetlab/deploy-state
OLD="$STATE/previous-release"
VERSION_FILE=/etc/planetlab/deployed-version
PREVIOUS_NGINX="$STATE/previous-nginx"
PREVIOUS_SERVICE="$STATE/previous-service"
PREVIOUS_VERSION="$STATE/previous-version"
APPROVAL=/etc/planetlab/nginx-adopt.sha256
VENV_RECORD="$STATE/staged-venv-v$VERSION"
[[ -f "$RELEASE/backend/app.py" ]] || { echo "Release not staged: $RELEASE"; exit 2; }
command -v nginx >/dev/null || { echo 'nginx required'; exit 2; }
command -v python3 >/dev/null || { echo 'python3 required'; exit 2; }
command -v systemctl >/dev/null || { echo 'systemd required'; exit 2; }

# Approval from v0.3.1 is preserved: never overwrite unmanaged sites without explicit authorization.
is_managed() { [[ -f "$1" ]] && [[ "$(head -n 1 "$1")" == '# MANAGED BY PLANETLAB WATCHER' ]]; }
nginx_adoption_approved() {
  [[ -f "$APPROVAL" && -f "$SITE" && ! -L "$SITE" ]] || return 1
  local actual expected
  actual="$(sha256sum "$SITE" | awk '{print $1}')"
  expected="$(head -n 1 "$APPROVAL")"
  [[ "$actual" =~ ^[0-9a-f]{64}$ && "$actual" == "$expected" ]] || return 1
  [[ -L /etc/nginx/sites-enabled/planetlab.me && "$(readlink -f /etc/nginx/sites-enabled/planetlab.me)" == "$SITE" ]] || return 1
}
check_nginx_ownership() {
  if [[ -e "$SITE" ]] && ! is_managed "$SITE" && ! nginx_adoption_approved; then
    echo "REFUSING unmanaged Nginx vhost: $SITE"; return 3
  fi
  if [[ -e "$SERVICE" ]] && ! is_managed "$SERVICE"; then
    echo "REFUSING unmanaged systemd service: $SERVICE"; return 3
  fi
  if [[ ! -e "$SITE" ]] && nginx -T 2>&1 | grep -E 'server_name[[:space:]]+[^;]*planetlab\.me' >/dev/null; then
    echo 'Duplicate/external planetlab.me Nginx site found; review manually'; return 3
  fi
}

# Immutable venv cache keyed by requirements and interpreter version.
venv_target() {
  local pyver fingerprint
  pyver="$(python3 -c 'import sys;print(".".join(map(str,sys.version_info[:2])))')"
  fingerprint="$( { sha256sum "$RELEASE/backend/requirements.txt" | cut -d' ' -f1; printf '%s\n' "$pyver"; } | sha256sum | cut -c1-20)"
  printf '%s/py%s-%s\n' "$VENV_ROOT" "$pyver" "$fingerprint"
}

if [[ "$ACTION" == prepare ]]; then
  nginx -t
  if [[ ! -f /etc/letsencrypt/live/planetlab.me/fullchain.pem || ! -f /etc/letsencrypt/live/planetlab.me/privkey.pem ]]; then
    echo 'Missing planetlab.me TLS certificate'; exit 3
  fi
  check_nginx_ownership
  if [[ -e "$APPROOT/current" && ! -L "$APPROOT/current" ]]; then
    echo 'Refusing to replace existing non-symlink current path'; exit 3
  fi
  if [[ -L "$APPROOT/current" ]]; then
    existing="$(readlink -f "$APPROOT/current")"
    [[ "$existing" == "$APPROOT"/releases/v* ]] || { echo 'Unexpected current target'; exit 3; }
  fi
  id planetlab >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin planetlab
  install -d -m 755 "$APPROOT" "$APPROOT/releases" "$VENV_ROOT" "$RELEASE"
  # Source files are read-only to planetlab, but executable paths must be traversable.
  if ! runuser -u planetlab -- test -r "$RELEASE/backend/app.py"; then
    echo 'Release not readable by planetlab. Check directory modes and mount flags.'
    namei -l "$RELEASE/backend/app.py" || true
    exit 3
  fi
  install -d -m 750 -o planetlab -g planetlab "$DATA" "$DATA/media" "$DATA/backups"
  install -d -m 700 /etc/planetlab "$STATE"
  if [[ ! -f "$ENV" ]]; then
    SECRET="$(python3 -c 'import secrets;print(secrets.token_hex(48))')"
    printf 'PLANETLAB_SECRET_KEY=%s\nPLANETLAB_DATA_DIR=%s\n' "$SECRET" "$DATA" > "$ENV"
    chmod 600 "$ENV"
  fi
  VENV="$(venv_target)"
  if [[ ! -e "$VENV" ]]; then
    # Make venv in its FINAL location: console entrypoints contain absolute shebang paths.
    # Only this newly created venv is removable on a failed install.
    python3 -m venv "$VENV"
    trap 'rm -rf -- "$VENV"' EXIT
    "$VENV/bin/python" -m pip install --disable-pip-version-check --quiet -r "$RELEASE/backend/requirements.txt"
    "$VENV/bin/python" -m pip check
    trap - EXIT
  elif [[ ! -x "$VENV/bin/gunicorn" ]]; then
    echo "Incomplete venv from another run: $VENV; stopping to prevent unsafe reuse"; exit 3
  fi
  # Detect unexpected root-only modes and noexec mounts before deployment.
  if ! runuser -u planetlab -- "$VENV/bin/python" -c 'import flask, sqlalchemy, gunicorn; print("Runtime access OK")'; then
    echo "Runtime not executable by planetlab: $VENV"
    namei -l "$VENV/bin/python" || true
    findmnt -no TARGET,OPTIONS -T "$VENV/bin/python" || true
    exit 3
  fi
  printf '%s\n' "$VENV" > "$VENV_RECORD"
  chmod 600 "$VENV_RECORD"
  # Important: do not open or mutate live databases during prepare.
  echo "READY: v$VERSION source=$RELEASE venv=$VENV; no live service changed"
  exit 0
fi

# The watcher may request the exact venv path during staging tests.
if [[ "$ACTION" == venv-path ]]; then
  [[ -s "$VENV_RECORD" ]] || { echo 'Prepare must succeed first'; exit 2; }
  STORED="$(cat "$VENV_RECORD")"
  [[ "$STORED" == "$VENV_ROOT"/py* && -x "$STORED/bin/python" ]] || exit 2
  printf '%s\n' "$STORED/bin/python"
  exit 0
fi

write_nginx() {
  local target="$1"
  cat > "$target" <<'NGINX'
# MANAGED BY PLANETLAB WATCHER
server {
  listen 80;
  server_name planetlab.me;
  return 301 https://$host$request_uri;
}
server {
  listen 443 ssl;
  server_name planetlab.me;
  ssl_certificate /etc/letsencrypt/live/planetlab.me/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/planetlab.me/privkey.pem;
  include /etc/letsencrypt/options-ssl-nginx.conf;
  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
  location / {
    proxy_pass http://127.0.0.1:8765;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 120s;
    client_max_body_size 51m;
  }
}
NGINX
}

if [[ "$ACTION" == activate ]]; then
  [[ -s "$VENV_RECORD" ]] || { echo 'Run prepare first'; exit 2; }
  VENV="$(cat "$VENV_RECORD")"
  [[ "$VENV" == "$VENV_ROOT"/py* && -x "$VENV/bin/gunicorn" ]] || exit 2
  check_nginx_ownership
  install -d -m 700 "$STATE"
  if [[ -e "$APPROOT/current" && ! -L "$APPROOT/current" ]]; then echo 'Refusing to replace existing current path'; exit 3; fi
  if [[ -L "$APPROOT/current" ]]; then
    previous="$(readlink -f "$APPROOT/current")"
    [[ "$previous" == "$APPROOT"/releases/v* ]] || { echo 'Unexpected rollback target';exit 3; }
    printf '%s\n' "$previous" > "$OLD"
  else
    : > "$OLD"
  fi
  if [[ -f "$VERSION_FILE" ]]; then cp -p "$VERSION_FILE" "$PREVIOUS_VERSION";else rm -f "$PREVIOUS_VERSION";fi
  if [[ -f "$SITE" ]]; then cp -p "$SITE" "$PREVIOUS_NGINX";else rm -f "$PREVIOUS_NGINX";fi
  if [[ -f "$SERVICE" ]]; then cp -p "$SERVICE" "$PREVIOUS_SERVICE";else rm -f "$PREVIOUS_SERVICE";fi
  if [[ -f "$SITE" ]] && ! is_managed "$SITE"; then
    install -d -m 700 /etc/planetlab/nginx-backups
    cp -p "$SITE" "/etc/planetlab/nginx-backups/planetlab.me.adopted-$(date -u +%Y%m%dT%H%M%SZ).conf"
  fi
  # SQLite snapshot only when SQLite is configured, prior to running the new app.
  if [[ -f "$DATA/planetlab.sqlite3" ]]; then
    python3 - "$DATA/planetlab.sqlite3" "$DATA/backups/pre-v${VERSION}-$(date -u +%Y%m%d%H%M%S).sqlite3" <<'PYSQL'
import sqlite3,sys
src=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
dst=sqlite3.connect(sys.argv[2])
try:src.backup(dst)
finally:dst.close();src.close()
PYSQL
    chown planetlab:planetlab "$DATA"/backups/pre-v"$VERSION"-*.sqlite3
  fi
  # systemd unit points directly to the external venv; no shell wrapper or webroot venv.
  cat > "$SERVICE" <<UNIT
# MANAGED BY PLANETLAB WATCHER
[Unit]
Description=Planet Lab Flask and WebSocket service
After=network.target
[Service]
Type=simple
User=planetlab
Group=planetlab
WorkingDirectory=$APPROOT/current
EnvironmentFile=$ENV
Environment=PYTHONDONTWRITEBYTECODE=1
ExecStart=$VENV/bin/gunicorn --workers 1 --worker-class gthread --threads 24 --bind 127.0.0.1:8765 --timeout 90 --access-logfile - backend.app:create_app()
Restart=always
RestartSec=4
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true
ReadWritePaths=$DATA
[Install]
WantedBy=multi-user.target
UNIT
  write_nginx "$SITE"
  ln -sfn "$SITE" /etc/nginx/sites-enabled/planetlab.me
  if ! nginx -t; then
    echo 'Nginx config invalid, restoring'; "$0" "$VERSION" rollback; exit 1
  fi
  ln -sfn "$RELEASE" "$APPROOT/.current.next"
  mv -Tf "$APPROOT/.current.next" "$APPROOT/current"
  systemctl daemon-reload
  systemctl enable planetlab >/dev/null
  if ! systemctl restart planetlab; then "$0" "$VERSION" rollback; exit 1; fi
  nginx -s reload
  for i in $(seq 1 25); do
    if curl --fail --silent --max-time 2 http://127.0.0.1:8765/api/health | grep -q '"version":"'"$VERSION"'"'; then
      printf '%s\n' "$VERSION" > "$VERSION_FILE"
      echo "ACTIVATED: v$VERSION, API healthy"
      exit 0
    fi
    sleep 1
  done
  echo 'Health check timed out; rolling back'; "$0" "$VERSION" rollback; exit 1
fi

if [[ "$ACTION" == rollback ]]; then
  if [[ -f "$OLD" && -s "$OLD" ]]; then
    previous="$(cat "$OLD")"
    [[ "$previous" == "$APPROOT"/releases/v* && -d "$previous" ]] || { echo 'Invalid rollback target'; exit 1; }
    ln -sfn "$previous" "$APPROOT/.current.next"
    mv -Tf "$APPROOT/.current.next" "$APPROOT/current"
  else
    rm -f "$APPROOT/current"
  fi
  if [[ -f "$PREVIOUS_SERVICE" ]]; then cp -p "$PREVIOUS_SERVICE" "$SERVICE";else rm -f "$SERVICE";fi
  if [[ -f "$PREVIOUS_NGINX" ]]; then cp -p "$PREVIOUS_NGINX" "$SITE";else rm -f "$SITE" /etc/nginx/sites-enabled/planetlab.me;fi
  if [[ -f "$PREVIOUS_VERSION" ]]; then cp -p "$PREVIOUS_VERSION" "$VERSION_FILE";else rm -f "$VERSION_FILE";fi
  systemctl daemon-reload
  if [[ -f "$SERVICE" ]]; then systemctl restart planetlab;else systemctl stop planetlab || true;fi
  nginx -t && nginx -s reload
  echo 'ROLLBACK COMPLETED; persistent data retained'
  exit 0
fi

echo "Unknown action: $ACTION"; exit 2

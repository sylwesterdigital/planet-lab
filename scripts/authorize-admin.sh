#!/usr/bin/env bash
# One-time operator-controlled binding of an EXISTING registered account to admin.
# Runs on Ubuntu after a verified release is active; not called by the watcher.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Must run as root on the Planet Lab host'; exit 2; }
APPROOT=/opt/planetlab
ENV=/etc/planetlab/planetlab.env
DATA=/var/lib/planetlab
[[ -L $APPROOT/current && -f $ENV && -s /etc/planetlab/deployed-version ]] || { echo 'Deploy the app first'; exit 2; }
read -r -p 'Existing Planet Lab account HANDLE to authorise: ' handle
[[ $handle =~ ^[a-z0-9_-]{3,32}$ ]] || { echo 'Invalid handle'; exit 2; }
# Root reads only for the process environment; never print secrets.
set -a
# shellcheck disable=SC1090
. "$ENV"
set +a
# Use the exact Python executable referenced by the active service, not an arbitrary venv.
VENV=$(systemctl show planetlab -p ExecStart --value | grep -oE '/opt/planetlab/venvs/[^ ;]+/bin/gunicorn' | head -1 | sed 's@/bin/gunicorn$@/bin/python@' || true)
[[ -n $VENV && -x $VENV ]] || { echo 'Cannot determine active Planet Lab Python environment'; exit 2; }
uid=$(cd "$APPROOT/current" && runuser -u planetlab -- "$VENV" - "$handle" <<'PY'
import os,sys
from sqlalchemy import create_engine,select
from backend.models import User
from sqlalchemy.orm import Session
from pathlib import Path
base=Path(os.environ.get('PLANETLAB_DATA_DIR','/var/lib/planetlab'))
url=os.environ.get('PLANETLAB_DATABASE_URL',f'sqlite:///{base/"planetlab.sqlite3"}')
engine=create_engine(url)
with Session(engine) as db:
 user=db.scalar(select(User).where(User.handle==sys.argv[1]))
 print(user.id if user else '')
PY
)
[[ $uid =~ ^[0-9]+$ ]] || { echo 'Account does not exist. Register through the site first.'; exit 3; }
echo "Authorise account '$handle' (database ID $uid) to manage paid AI integrations."
read -r -p 'Type AUTHORIZE to continue: ' confirm
[[ $confirm == AUTHORIZE ]] || { echo 'Cancelled.'; exit 0; }
backup="/etc/planetlab/planetlab.env.pre-ai-admin.$(date -u +%Y%m%dT%H%M%SZ)"
cp -p "$ENV" "$backup"
tmp=$(mktemp /etc/planetlab/.planetlab-admin.XXXXXX)
trap 'rm -f "$tmp"' EXIT
chmod 600 "$tmp"
grep -Ev '^PLANETLAB_ADMIN_(HANDLE|USER_ID)=' "$ENV" > "$tmp" || true
printf 'PLANETLAB_ADMIN_HANDLE=%s\nPLANETLAB_ADMIN_USER_ID=%s\n' "$handle" "$uid" >> "$tmp"
cat "$tmp" > "$ENV"
chmod 600 "$ENV"
if ! systemctl restart planetlab || ! systemctl is-active --quiet planetlab; then
  cp -p "$backup" "$ENV"
  systemctl restart planetlab || true
  echo 'Restart failed. Previous environment restored.'; exit 4
fi
echo "Administrator authorised: $handle (ID $uid). Existing config backed up."

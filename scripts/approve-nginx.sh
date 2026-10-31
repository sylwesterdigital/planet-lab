#!/usr/bin/env bash
# One-time, explicit opt-in to replace only the existing planetlab.me vhost.
# This script DOES NOT modify the live Nginx site or reload Nginx.
set -Eeuo pipefail
SITE=/etc/nginx/sites-available/planetlab.me
LINK=/etc/nginx/sites-enabled/planetlab.me
APPROVAL=/etc/planetlab/nginx-adopt.sha256
BACKUP_DIR=/etc/planetlab/nginx-backups
[[ "$(id -u)" == 0 ]] || { echo 'Must run as root.'; exit 2; }
[[ -f "$SITE" && ! -L "$SITE" ]] || { echo "Expected regular file $SITE; refusing symlink/unexpected layout."; exit 2; }
[[ -L "$LINK" && "$(readlink -f "$LINK")" == "$SITE" ]] || { echo "Expected enabled symlink $LINK -> $SITE; inspect Nginx manually."; exit 2; }
nginx -t || { echo 'Existing Nginx is invalid; refusing approval'; exit 2; }
SERVICE=/etc/systemd/system/planetlab.service
if [[ -e "$SERVICE" && "$(head -n 1 "$SERVICE")" != '# MANAGED BY PLANETLAB WATCHER' ]]; then
  echo "REFUSING: existing unmanaged systemd service $SERVICE must be reviewed separately."; exit 2
fi
python3 - "$SITE" <<'PY'
from pathlib import Path
import re,sys
contents=Path(sys.argv[1]).read_text()
# Check actual server_name directives; unrelated vhosts must never be replaced.
stripped='\n'.join(line.split('#',1)[0] for line in contents.splitlines())
names=[word for match in re.findall(r'(?m)^\s*server_name\s+([^;]+);',stripped) for word in match.split()]
allowed={'planetlab.me','www.planetlab.me'}
if not names or 'planetlab.me' not in names or set(names)-allowed:
    sys.exit('REFUSING: file contains no planetlab.me server_name or contains other domains: '+repr(names))
if 'include /etc/nginx/' in stripped:
    print('WARNING: existing config has includes; confirm their contents before adopting.')
print('Confirmed server names:',', '.join(sorted(set(names))))
PY
printf '\n=== EXISTING NGINX SITE (up to 200 lines) ===\n'
sed -n '1,200p' "$SITE"
printf '\n=== EFFECT OF APPROVAL ===\n'
echo 'This action only backs up and approves the current Nginx file hash.'
echo 'On the next verified release, Planet Lab replaces this vhost with its managed reverse proxy:'
echo '  80/443 planetlab.me + www.planetlab.me -> 127.0.0.1:8765'
echo '  TLS: /etc/letsencrypt/live/planetlab.me/{fullchain,privkey}.pem'
echo 'Custom locations, redirects, headers and limits in the old file will NOT be migrated.'
echo 'An unchanged copy of the old file will remain in /etc/planetlab/nginx-backups/.'
echo 'The application release and database directories are not modified by this approval.'
printf '\n'
read -r -p 'Type exactly ADOPT planetlab.me to authorize the future replacement: ' CONFIRM </dev/tty
[[ "$CONFIRM" == 'ADOPT planetlab.me' ]] || { echo 'Cancelled. No changes.'; exit 1; }
install -d -m 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$BACKUP_DIR/planetlab.me.pre-adoption.$STAMP.conf"
cp -p -- "$SITE" "$BACKUP"
chmod 600 "$BACKUP"
SHA="$(sha256sum "$SITE" | awk '{print $1}')"
printf '%s\n' "$SHA" > "$APPROVAL.new"
chmod 600 "$APPROVAL.new"
mv -f -- "$APPROVAL.new" "$APPROVAL"
echo "APPROVED: SHA256 $SHA"
echo "BACKUP: $BACKUP"
echo 'No Nginx reload was performed. Re-run the release watcher to deploy.'

#!/usr/bin/env bash
# One-time launchd setup, or status/stop control. No elevated privileges required.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL='me.planetlab.release-watcher'
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
MODE="${1:-install}"
LOGDIR="$ROOT/.planetlab/logs"
if [[ "$(uname -s)" != Darwin ]]; then echo 'macOS only' >&2; exit 2; fi
if [[ ! -f "$ROOT/planetlab-watch.sh" || ! -f "$ROOT/scripts/release_watcher.py" || ! -d "$ROOT/.git" ]]; then
  echo "Expected cloned Planet Lab repository: $ROOT" >&2; exit 2
fi
case "$MODE" in
  status)
    echo "WATCHER: $LABEL"
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      echo 'STATUS: registered in launchd (inspect logs for deployment success)'
      launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -E 'state =|pid =|last exit code =|path =' | head -12 || true
    else
      echo 'STATUS: not registered; install to enable automatic watching'
    fi
    echo "LOG: $LOGDIR/watcher.out.log"
    [[ -s "$ROOT/.planetlab/deployed.json" ]] && cat "$ROOT/.planetlab/deployed.json" || true
    exit 0;;
  stop)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    echo 'Stopped for this login session (will start on next login).'
    exit 0;;
  logs)
    mkdir -p "$LOGDIR"
    touch "$LOGDIR/watcher.out.log"
    exec tail -n 80 -f "$LOGDIR/watcher.out.log";;
  install) ;;
  *) echo 'Usage: install-macos-watcher.sh [install|status|stop|logs]' >&2; exit 2;;
esac
mkdir -p "$HOME/Library/LaunchAgents" "$LOGDIR" "$ROOT/updates/processed" "$ROOT/updates/failed"
# Use installed Python to emit valid, safely escaped macOS plist XML.
PYTHON_BIN="$(command -v python3 || true)"
NODE_BIN="$(command -v node || true)"
[[ -n "$PYTHON_BIN" && -n "$NODE_BIN" ]] || { echo 'python3 and node are required on Mac' >&2;exit 2; }
PATH_VALUE="$(dirname "$PYTHON_BIN"):$(dirname "$NODE_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
python3 - "$ROOT" "$LABEL" "$PLIST" "$LOGDIR" "$PATH_VALUE" <<'PY'
import plistlib,sys
from pathlib import Path
root,label,plist,logdir,path=sys.argv[1:]
content={
    'Label':label,
    'ProgramArguments':['/bin/bash',str(Path(root)/'planetlab-watch.sh'),'--interval','4'],
    'WorkingDirectory':root,
    'RunAtLoad':True,
    'KeepAlive':True,
    'ThrottleInterval':10,
    'ProcessType':'Background',
    'EnvironmentVariables':{'PATH':path,'GIT_TERMINAL_PROMPT':'0','PYTHONUNBUFFERED':'1'},
    'StandardOutPath':str(Path(logdir)/'watcher.out.log'),
    'StandardErrorPath':str(Path(logdir)/'watcher.err.log'),
}
Path(plist).write_bytes(plistlib.dumps(content))
Path(plist).chmod(0o600)
PY
# Relaunch the existing service if it was installed. The plist remains registered
# and will start automatically at future user logins. No sudo / daemon root privileges.
launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
launchctl enable "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
if ! launchctl bootstrap "$DOMAIN" "$PLIST"; then
  echo "launchctl bootstrap failed; see: $PLIST" >&2
  exit 1
fi
launchctl kickstart -k "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
if ! launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  echo 'Could not verify launchd registration' >&2;exit 1
fi
echo 'PLANET LAB WATCHER ENABLED'
echo "Monitoring: $ROOT/updates/"
echo "Runs on login, checks every 4 seconds and restarts if it exits."
echo 'The watcher handles: ZIP validation, tests, GitHub SSH push, Ubuntu SSH deploy, health and rollback.'
echo "Log: $LOGDIR/watcher.out.log"
echo "Service: $LABEL"
echo 'To ship later versions, drag PLANETLAB_RELEASE_vX.Y.Z.zip into updates/. No Terminal commands.'

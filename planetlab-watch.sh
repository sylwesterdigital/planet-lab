#!/usr/bin/env bash
# Planet Lab Mac watcher (source remains in the repository).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$ROOT/scripts/release_watcher.py" "$@"

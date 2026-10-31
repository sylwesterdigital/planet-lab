#!/usr/bin/env python3
"""Record a verified activation in persistent storage, not inside release source."""
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

if len(sys.argv)!=3 or not re.fullmatch(r'\d+\.\d+\.\d+',sys.argv[1]) or not re.fullmatch(r'[0-9a-f]{7,40}',sys.argv[2]):
    raise SystemExit('Usage: record-release.py <semver> <git SHA>')
version,sha=sys.argv[1:]
path=Path('/var/lib/planetlab/deployment-history.json')
if not path.parent.is_dir():raise SystemExit('Persistent PlanetLab directory is missing')
try:
    current=json.loads(path.read_text()) if path.exists() else {}
except (OSError,ValueError):
    raise SystemExit('Existing release history malformed; not overwriting')
releases=current.get('releases',[])
if not isinstance(releases,list):raise SystemExit('Existing release history malformed')
entry={'version':version,'deployedAt':dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z'),'git':sha}
releases=[entry]+[e for e in releases if isinstance(e,dict) and e.get('version')!=version]
target=path.with_suffix('.json.tmp')
fd=os.open(target,os.O_CREAT|os.O_WRONLY|os.O_TRUNC,0o644)
with os.fdopen(fd,'w') as file:
    json.dump({'releases':releases[:40]},file,indent=2)
    file.write('\n')
    file.flush();os.fsync(file.fileno())
os.chmod(target,0o644)
os.replace(target,path)
print('Deployment log recorded for v'+version)

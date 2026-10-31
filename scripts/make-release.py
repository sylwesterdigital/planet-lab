#!/usr/bin/env python3
"""Create an immutable, hash-listed ZIP from the source tree for the Mac watcher."""
import argparse
import hashlib
import json
import re
import stat
import zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
IGNORE={'.git','.venv','.planetlab','updates','__MACOSX','__pycache__','node_modules','.pytest_cache'}

parser=argparse.ArgumentParser()
parser.add_argument('--version',required=True,help='semver e.g. 0.3.0')
parser.add_argument('--out',type=Path,default=ROOT/'updates')
parser.add_argument('--changes',default='Versioned Planet Lab release')
args=parser.parse_args()
if not re.fullmatch(r'\d+\.\d+\.\d+',args.version):parser.error('Invalid semver')
if f"VERSION = '{args.version}'" not in (ROOT/'backend/app.py').read_text():parser.error('Change backend/app.py VERSION first')
files=[]
for path in ROOT.rglob('*'):
    if not path.is_file() or path.is_symlink() or any(p in IGNORE for p in path.relative_to(ROOT).parts):continue
    rel=path.relative_to(ROOT).as_posix()
    if rel.endswith(('.pyc','.pyo','.log')) or rel=='.DS_Store' or rel.startswith('.env') or rel.endswith('.sqlite3'):continue
    files.append((rel,path.read_bytes()))
files.sort()
if not files:parser.error('No files')
hashes={rel:hashlib.sha256(data).hexdigest() for rel,data in files}
manifest={'project':'planetlab.me','version':args.version,'changes':[args.changes],'sha256':hashes}
args.out.mkdir(parents=True,exist_ok=True)
output=args.out/f'PLANETLAB_RELEASE_v{args.version}.zip'
with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    z.writestr('manifest.json',json.dumps(manifest,indent=2,sort_keys=True)+'\n')
    for rel,body in files:z.writestr('app/'+rel,body)
print(f'{output} ({len(files)} files; {output.stat().st_size} bytes)')

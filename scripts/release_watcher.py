#!/usr/bin/env python3
"""Planet Lab: signed-by-hash release ZIP -> tests -> remote prepare -> git -> activation/rollback.

Run on macOS in the cloned repository root. Never copies live DBs or media.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
UPDATES = ROOT / 'updates'
STATE = ROOT / '.planetlab'
SSH_HOST = 'root@planetlab.me'
SSH_PORT = '333'
GITHUB = 'git@github.com:sylwesterdigital/planet-lab.git'
WEBROOT = '/var/www/planetlab.me'
APPROOT = '/opt/planetlab'
URL = 'https://planetlab.me'
SEMVER = re.compile(r'^\d+\.\d+\.\d+$')
REQUIRED = ('index.html', 'app.mjs', 'planner.mjs', 'collab.mjs', 'house/index.html',
            'backend/app.py', 'backend/models.py', 'backend/requirements.txt',
            'scripts/install-ubuntu.sh', 'scripts/release_watcher.py',
            'planetlab-watch.sh', 'test-planner.mjs', 'tests/test_backend.py', 'README.md')


class ReleaseError(Exception):
    pass


def log(msg):
    print(f'[{dt.datetime.now().strftime("%H:%M:%S")}] {msg}', flush=True)


def run(args, cwd=None, timeout=100):
    args = list(map(str, args))
    outcome = subprocess.run(args, cwd=cwd, text=True, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, timeout=timeout)
    if outcome.returncode:
        raise ReleaseError('FAILED: ' + shlex.join(args) + '\n' + outcome.stdout[-2500:])
    return outcome.stdout.strip()


def ssh(command, timeout=120):
    return run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                '-p', SSH_PORT, SSH_HOST, command], timeout=timeout)


def remote_path(value):
    return shlex.quote(value)


def semver(value):
    return tuple(map(int, value.split('.')))


def get_deployed():
    try:
        data = json.loads((STATE / 'deployed.json').read_text())
        value = data.get('version')
        return value if isinstance(value, str) and SEMVER.fullmatch(value) else '0.0.0'
    except (OSError, ValueError, TypeError):
        return '0.0.0'


def verify(archive, output):
    with zipfile.ZipFile(archive) as zipfile_obj:
        members = zipfile_obj.infolist()
        if len(members) > 300 or sum(x.file_size for x in members) > 25_000_000:
            raise ReleaseError('Release ZIP too large')
        names = [m.filename for m in members if not m.is_dir()]
        if len(names) != len(set(names)) or 'manifest.json' not in names:
            raise ReleaseError('Missing manifest or duplicated ZIP filenames')
        for member in members:
            path = PurePosixPath(member.filename)
            if path.is_absolute() or '..' in path.parts or '\\' in member.filename:
                raise ReleaseError('Unsafe ZIP path: ' + member.filename)
            if stat.S_ISLNK(member.external_attr >> 16):
                raise ReleaseError('Symlinks in release ZIP forbidden')
            if member.filename != 'manifest.json' and (not path.parts or path.parts[0] != 'app'):
                raise ReleaseError('Unexpected ZIP entry: ' + member.filename)
            if member.compress_size and member.file_size > 200 * member.compress_size and member.file_size > 2_000_000:
                raise ReleaseError('Unreasonable ZIP compression ratio')
        manifest = json.loads(zipfile_obj.read('manifest.json'))
        version = manifest.get('version')
        if not isinstance(version, str) or not SEMVER.fullmatch(version):
            raise ReleaseError('Invalid version')
        match = re.search(r'v(\d+\.\d+\.\d+)', archive.name)
        if not match or match.group(1) != version:
            raise ReleaseError('Filename and manifest version mismatch')
        if semver(version) <= semver(get_deployed()):
            raise ReleaseError(f'Version must exceed last deployed v{get_deployed()}')
        hashes = manifest.get('sha256')
        if not isinstance(hashes, dict) or not hashes or set('app/' + p for p in hashes) != set(n for n in names if n.startswith('app/')):
            raise ReleaseError('SHA256 manifest does not match included files')
        if not isinstance(manifest.get('changes'), list) or not manifest['changes']:
            raise ReleaseError('Manifest must explain changes')
        for rel, expected in hashes.items():
            path = PurePosixPath(rel)
            if path.is_absolute() or '..' in path.parts or not re.fullmatch(r'[a-f0-9]{64}', expected):
                raise ReleaseError('Unsafe file/hash: ' + rel)
            contents = zipfile_obj.read('app/' + rel)
            if hashlib.sha256(contents).hexdigest() != expected:
                raise ReleaseError('SHA256 mismatch: ' + rel)
            destination = output.joinpath(*path.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(contents)
        for item in REQUIRED:
            if not (output / item).is_file():
                raise ReleaseError('Missing required release file: ' + item)
        if f"VERSION = '{version}'" not in (output / 'backend/app.py').read_text():
            raise ReleaseError('Backend code version mismatch')
        return manifest


def local_tests(stage):
    for source in ['app.mjs','planner.mjs','collab.mjs','test-planner.mjs']:
        run(['node', '--check', source], cwd=stage, timeout=15)
    output = run(['node', 'test-planner.mjs'], cwd=stage, timeout=25)
    log(output)
    import ast
    for filename in ['backend/app.py','backend/models.py','scripts/release_watcher.py','tests/test_backend.py']:
        ast.parse((stage / filename).read_text(), filename=filename)
    run(['bash', '-n', 'scripts/install-ubuntu.sh'], cwd=stage, timeout=15)
    installer=(stage / 'scripts/install-ubuntu.sh').read_text()
    watcher=(stage / 'scripts/release_watcher.py').read_text()
    if 'APPROOT=/opt/planetlab' not in installer or 'VENV_ROOT="$APPROOT/venvs"' not in installer or "APPROOT = '/opt/planetlab'" not in watcher:
        raise ReleaseError('Deployment must keep releases and virtualenvs outside the Nginx webroot')
    index = (stage / 'index.html').read_text()
    if 'collab.mjs' not in index or 'app.mjs' not in index or 'xrControls' not in index:
        raise ReleaseError('Missing required multiplayer/Three.js/XR interface entrypoints')
    log('Local JS, planner, Python syntax, shell, frontend tests passed')


def git_preflight(stage, hashes):
    if not (ROOT / '.git').exists():
        raise ReleaseError('Not in cloned Git repository. Run setup-macos.sh first.')
    branch = run(['git','branch','--show-current'],cwd=ROOT)
    if branch != 'main':
        raise ReleaseError(f'Expected main branch, found {branch}')
    remote = run(['git','remote','get-url','origin'],cwd=ROOT)
    if remote not in (GITHUB, 'https://github.com/sylwesterdigital/planet-lab.git',
                      'ssh://git@github.com/sylwesterdigital/planet-lab.git'):
        raise ReleaseError('Unexpected GitHub origin: ' + remote)
    staged = run(['git', 'diff', '--cached','--name-only'],cwd=ROOT)
    if staged:
        raise ReleaseError('Existing staged changes: ' + staged)
    dirty = set(run(['git','diff','--name-only'], cwd=ROOT).splitlines())
    for rel in hashes:
        target=ROOT/rel
        if target.is_symlink():
            raise ReleaseError('Refusing to overwrite symlink: ' + rel)
        if rel in dirty and (not target.is_file() or target.read_bytes() != (stage/rel).read_bytes()):
            raise ReleaseError('Release conflicts with uncommitted edits: ' + rel)
    run(['git', 'var', 'GIT_AUTHOR_IDENT'], cwd=ROOT)
    remote_main = run(['git', '-c', 'core.sshCommand=ssh -o BatchMode=yes -o ConnectTimeout=10',
                       'ls-remote', 'origin', 'refs/heads/main'], cwd=ROOT, timeout=35)
    # Accept empty repositories but refuse to overwrite diverged histories.
    if remote_main:
        run(['git', 'fetch', '--no-tags', 'origin', 'main'], cwd=ROOT, timeout=45)
        if subprocess.run(['git','rev-parse','--verify','HEAD'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode == 0:
            relation = subprocess.run(['git','merge-base','--is-ancestor','FETCH_HEAD','HEAD'],cwd=ROOT,
                                      stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            if relation.returncode:
                raise ReleaseError('GitHub main diverged; use git pull --ff-only, then retry')
        else:
            raise ReleaseError('Remote main has history but local main has no commits; clone repository properly')
    ssh('test -d /var/www/planetlab.me && command -v nginx && command -v rsync && command -v python3 && command -v curl')
    log('GitHub, working-tree and Ubuntu SSH preflight passed')


def deploy_stage(stage, version):
    release = f'{APPROOT}/releases/v{version}'
    ssh(f'''set -eu
      install -d -m 755 /opt/planetlab /opt/planetlab/releases
      install -d -m 755 {remote_path(release)}
      if [ -L {remote_path(APPROOT+'/current')} ] && [ "$(readlink -f {remote_path(APPROOT+'/current')})" = {remote_path(release)} ]; then
          echo 'Same release is live: refusing to overwrite'; exit 2
      fi''')
    run(['rsync','-az','--delete','--exclude=__pycache__','--exclude=*.pyc',
         '-e',f'ssh -p {SSH_PORT}',str(stage)+'/',f'{SSH_HOST}:{release}/'], timeout=240)
    ssh(f'bash {remote_path(release+"/scripts/install-ubuntu.sh")} {version} prepare', timeout=240)
    # Run API integration tests with remote release dependencies before going live.
    output = ssh(f'''set -eu; cd {remote_path(release)};
      . /etc/planetlab/planetlab.env
      export PLANETLAB_SECRET_KEY PLANETLAB_DATA_DIR
      VENV_PY="$(bash {remote_path(release+'/scripts/install-ubuntu.sh')} {version} venv-path)"
      runuser -u planetlab -- "$VENV_PY" -m unittest discover -s tests -p 'test_backend.py' -v''', timeout=70)
    if 'OK' not in output:
        raise ReleaseError('Remote backend tests were not confirmed: ' + output[-400:])
    log('Ubuntu release staged, dependencies installed, backend tests passed. Live unchanged.')


def git_publish(stage, manifest):
    hashes = manifest['sha256']
    copied=[]
    for rel in sorted(hashes):
        dest=ROOT/rel
        if rel == '.gitignore' and dest.exists():
            continue
        dest.parent.mkdir(parents=True,exist_ok=True)
        if dest.is_symlink():raise ReleaseError('Symlink at ' + rel)
        shutil.copy2(stage/rel,dest)
        copied.append(rel)
    # Keep release bundles and watcher runtime files out of the Git index.
    exclude=ROOT/'.git/info/exclude'
    exclude.parent.mkdir(parents=True,exist_ok=True)
    previous=exclude.read_text() if exclude.exists() else ''
    lines=['/updates/','/.planetlab/','/__pycache__/','/.venv/']
    exclude.write_text(previous.rstrip('\n')+'\n'+'\n'.join(x for x in lines if x not in previous.splitlines())+'\n')
    try:
        run(['git','add','--',*copied],cwd=ROOT)
        if subprocess.run(['git','diff','--cached','--quiet'],cwd=ROOT).returncode:
            run(['git','commit','-m',f'planetlab: release v{manifest["version"]}'],cwd=ROOT)
        run(['git','-c','core.sshCommand=ssh -o BatchMode=yes -o ConnectTimeout=10',
             'push','origin','main'],cwd=ROOT,timeout=100)
        local=run(['git','rev-parse','HEAD'],cwd=ROOT)
        remote=run(['git','-c','core.sshCommand=ssh -o BatchMode=yes -o ConnectTimeout=10',
                    'ls-remote','origin','refs/heads/main'],cwd=ROOT,timeout=30)
        if not remote.startswith(local+'\t'):
            raise ReleaseError('GitHub did not confirm pushed commit')
    except Exception:
        # Never reset the user's working tree automatically.
        raise
    log(f'GitHub main updated: {local[:12]}')


def activate(version):
    release=f'{APPROOT}/releases/v{version}'
    ssh(f'bash {remote_path(release+"/scripts/install-ubuntu.sh")} {version} activate', timeout=110)
    # Always require both backend and public HTTPS smoke before confirming deployment.
    try:
        with urllib.request.urlopen(f'{URL}/api/health?release={version}',timeout=18) as response:
            data=json.load(response)
        if data.get('service')!='planetlab-api' or data.get('version')!=version or data.get('status')!='ok':
            raise ReleaseError('HTTPS public API returned unexpected version/health: '+repr(data))
        with urllib.request.urlopen(f'{URL}/?release={version}',timeout=18) as response:
            homepage=response.read(250000).decode('utf-8','replace')
        if 'PLANET' not in homepage or 'app.mjs' not in homepage:
            raise ReleaseError('HTTPS frontend is not the expected Planet Lab release')
    except Exception as exc:
        log(f'Public smoke failed: {exc}; requesting server rollback')
        ssh(f'bash {remote_path(release+"/scripts/install-ubuntu.sh")} {version} rollback', timeout=90)
        raise ReleaseError('Public HTTPS verification failed; rollback attempted') from exc
    log('HTTPS frontend and API verified; WebSocket endpoint configured in Nginx')


def process(archive, dry_run=False):
    STATE.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='release-',dir=STATE) as temp:
        stage=Path(temp)
        log(f'1/6 Verifying {archive.name}')
        manifest=verify(archive,stage)
        version=manifest['version']
        log(f'    Verified v{version}: {len(manifest["sha256"])} checksummed files')
        log('2/6 Running local static/planner tests')
        local_tests(stage)
        if dry_run:
            log(f'DRY RUN PASSED v{version}. GitHub and server NOT changed.')
            return
        log('3/6 Preflighting Git and target Ubuntu')
        git_preflight(stage,manifest['sha256'])
        log('4/6 Staging Ubuntu release and running integration tests')
        deploy_stage(stage,version)
        log('5/6 Committing and pushing verified source to GitHub')
        git_publish(stage,manifest)
        log('6/6 Activating and checking public HTTPS')
        activate(version)
        status={'version':version,'utc':dt.datetime.now(dt.timezone.utc).isoformat(),
                'github':GITHUB,'site':URL}
        tempstatus=STATE/'deployed.json.tmp';tempstatus.write_text(json.dumps(status,indent=2)+'\n');tempstatus.replace(STATE/'deployed.json')
        log(f'SUCCESS: v{version} live at {URL}, GitHub main updated')


def main():
    parser=argparse.ArgumentParser(description='PLANETLAB versioned ZIP deployment watcher for macOS')
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument('--once',action='store_true',help='Consume pending ZIPs once then exit')
    mode.add_argument('--dry-run',action='store_true',help='Validate ZIPs locally without GitHub or server changes')
    mode.add_argument('--status',action='store_true')
    parser.add_argument('--interval',type=int,default=4)
    args=parser.parse_args()
    if args.status:
        log('Last watcher-confirmed version: v'+get_deployed())
        try:
            with urllib.request.urlopen(URL+'/api/health',timeout=9) as res:log('Public API: '+res.read(1000).decode())
        except Exception as exc:log('Public API unavailable: '+str(exc))
        return 0
    if args.interval<1:parser.error('interval must be >=1')
    UPDATES.mkdir(exist_ok=True);STATE.mkdir(exist_ok=True)
    for sub in ('processed','failed'):(UPDATES/sub).mkdir(exist_ok=True)
    with (STATE/'watch.lock').open('a') as lock:
        try:fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise ReleaseError('Another Planet Lab watcher is running')
        log(f'Watching {UPDATES} · last deployed v{get_deployed()}')
        code_hash=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        failed=False
        while True:
            pending=sorted(UPDATES.glob('*.zip'))
            for archive in pending:
                if not (args.once or args.dry_run) and time.time()-archive.stat().st_mtime < 4:
                    continue
                try:
                    process(archive,args.dry_run)
                    if not args.dry_run:
                        archive.rename(UPDATES/'processed'/archive.name)
                except Exception as exc:
                    failed=True;log('FAILED: '+str(exc))
                    if not args.dry_run:
                        dest=UPDATES/'failed'/archive.name
                        if dest.exists():dest=dest.with_name(archive.stem+'-'+str(int(time.time()))+'.zip')
                        archive.rename(dest)
                        log(f'Moved to {dest}; release can be retried after correcting issue')
            if args.once or args.dry_run:return 1 if failed else 0
            updated=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
            if updated!=code_hash:
                log('Watcher updated from release; restarting')
                os.execv('/bin/bash',['bash',str(ROOT/'planetlab-watch.sh'),'--interval',str(args.interval)])
            time.sleep(args.interval)


if __name__=='__main__':
    try:sys.exit(main())
    except KeyboardInterrupt:log('Watcher stopped');sys.exit(0)
    except Exception as err:log('FATAL: '+str(err));sys.exit(1)

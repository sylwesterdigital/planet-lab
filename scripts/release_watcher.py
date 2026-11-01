#!/usr/bin/env python3
"""Planet Lab: integrity-verified release ZIP -> tests -> remote prepare -> Git SSH -> activation/rollback.

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
REQUIRED = ('index.html', 'app.mjs', 'planner.mjs', 'collab.mjs', 'studio.mjs', 'house/index.html',
            'backend/app.py', 'backend/models.py', 'backend/ai_routes.py', 'backend/integrations.py', 'backend/requirements.txt', 'api-console.mjs',
            'scripts/install-ubuntu.sh', 'scripts/release_watcher.py',
            'planetlab-watch.sh', 'test-planner.mjs', 'tests/test_backend.py', 'tests/test_ai.py', 'README.md')


class ReleaseError(Exception):
    pass


# Terminal output is intentionally concise: one START line, one line per passed
# phase, one final result. Full subprocess output goes into per-release logs.
# ANSI colours are applied only to status symbols and final outcomes.
COLOR_MODE = 'auto'
VERBOSE = False
ACTIVE_LOG = None
RUN = {'phase': 'idle', 'version': '?', 'github': False, 'live': False, 'started': None}
COLORS = {'INFO': '\x1b[2m', 'STEP': '\x1b[0m', 'WARN': '\x1b[33m',
          'ERROR': '\x1b[1;31m', 'SUCCESS': '\x1b[32m', 'LIVE': '\x1b[32m',
          'EVENT': '\x1b[36m', 'BEGIN': '\x1b[1;36m',
          'FINISH': '\x1b[1;32m', 'FAIL_FINISH': '\x1b[1;31m'}
SYMBOLS = {'INFO': '·', 'STEP': '›', 'WARN': '!', 'ERROR': '✕',
           'SUCCESS': '✓', 'LIVE': '✓', 'EVENT': '↻',
           'BEGIN': '▶', 'FINISH': '✓', 'FAIL_FINISH': '✕'}
RESET = '\x1b[0m'


def color_on():
    if os.environ.get('NO_COLOR') is not None or COLOR_MODE == 'never':
        return False
    return COLOR_MODE == 'always' or (COLOR_MODE == 'auto' and sys.stdout.isatty())


def detail(message):
    """Detailed, ANSI-free diagnostic text, printed only with --verbose."""
    if ACTIVE_LOG is not None:
        with ACTIVE_LOG.open('a', encoding='utf-8') as out:
            out.write(str(message).rstrip('\n') + '\n')
    if VERBOSE:
        for line in str(message).splitlines():
            print('           ' + line, flush=True)


def log(msg, level='INFO', show=True):
    """Write searchable full logs; keep default terminal output human-scannable."""
    stamp = dt.datetime.now().strftime('%H:%M:%S')
    entry = f'[{stamp}] [{level:<11}] {msg}'
    if ACTIVE_LOG is not None:
        with ACTIVE_LOG.open('a', encoding='utf-8') as out:
            out.write(entry + '\n')
    if not show:
        if VERBOSE:
            print('           ' + entry, flush=True)
        return
    marker = SYMBOLS.get(level, '·')
    prefix = f'[{stamp}]  '
    if color_on():
        colour = COLORS.get(level, '')
        # Do not tint entire multi-line messages blue. Status is the only accent;
        # final result gets extra visual priority.
        label = f'{colour}{marker}{RESET}'
        message = f'{prefix}{label} {msg}'
        if level in ('FINISH', 'FAIL_FINISH'):
            message = f'{prefix}{colour}{marker} {msg}{RESET}'
    else:
        message = f'{prefix}{marker} {msg}'
    print(message, flush=True)


def stage(name):
    RUN['phase'] = name
    detail('PHASE: ' + name)


def begin_run(archive, dry):
    global ACTIVE_LOG
    match = re.search(r'v(\d+\.\d+\.\d+)', archive.name)
    version = match.group(1) if match else '?'
    RUN.update(phase='validation', version=version, github=False, live=False,
               started=time.monotonic())
    (STATE / 'logs').mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S')
    ACTIVE_LOG = STATE / 'logs' / f'{stamp}-v{version}.log'
    print('', flush=True)
    log(f'PLANET LAB  /  {"DRY RUN START" if dry else "DEPLOYMENT START"}  /  v{version}', 'BEGIN')
    detail('Release archive: ' + archive.name)


def _short_error(error):
    """One concise diagnostic instead of echoing an SSH command and a traceback."""
    lines = [x.strip() for x in str(error).splitlines() if x.strip()]
    for prefix in ('AssertionError:', 'Permission denied', 'REFUSING',
                   'fatal:', 'ERROR:', 'Error:', 'FAILED (', 'FAIL: '):
        matches = [x for x in lines if x.startswith(prefix) or (prefix == 'Permission denied' and prefix in x)]
        if matches:
            return matches[-1][:220]
    return (lines[-1] if lines else 'Unknown error')[:220]


def finish_run(ok, dry=False, error=None):
    global ACTIVE_LOG
    seconds = int(time.monotonic() - RUN['started']) if RUN['started'] else 0
    name = 'DRY RUN' if dry else 'DEPLOYMENT'
    status = 'SUCCESS' if ok else 'FAILED'
    level = 'FINISH' if ok else 'FAIL_FINISH'
    log(f'PLANET LAB  /  {name} {status}  /  v{RUN["version"]}  /  {seconds}s', level)
    github = 'updated' if RUN['github'] else 'unchanged'
    ubuntu = 'live, verified' if RUN['live'] else ('not verified' if RUN['phase'].startswith('6/6') else 'unchanged')
    log(f'GitHub: {github}  |  Ubuntu: {ubuntu}  |  {URL}', 'INFO')
    if error:
        detail('COMPLETE ERROR: ' + str(error))
        log('Failure in ' + RUN['phase'] + ': ' + _short_error(error), 'ERROR')
    if ACTIVE_LOG:
        log(f'Full release log: {ACTIVE_LOG}', 'INFO', show=not ok or VERBOSE)
    ACTIVE_LOG = None
    print('', flush=True)


def run(args, cwd=None, timeout=100):
    args = list(map(str, args))
    try:
        outcome = subprocess.run(args, cwd=cwd, text=True, stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        detail(f'COMMAND TIMEOUT: {shlex.join(args)} after {timeout}s')
        raise ReleaseError(f'{args[0]} timed out after {timeout}s') from exc
    detail('$ ' + shlex.join(args))
    if outcome.stdout:
        detail(outcome.stdout)
    if outcome.returncode:
        raise ReleaseError(f'{Path(args[0]).name} exited {outcome.returncode}: {_short_error(outcome.stdout)}')
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
    for source in ['app.mjs','planner.mjs','collab.mjs','studio.mjs','ai-connections.mjs','api-console.mjs','test-planner.mjs','placebook.mjs','system-catalog.mjs','update-feed.mjs','workflow.mjs','earth-map.mjs','earth-terrain.mjs','test-earth.mjs','test-earth-map.mjs']:
        run(['node', '--check', source], cwd=stage, timeout=15)
    output = run(['node', 'test-planner.mjs'], cwd=stage, timeout=25)
    detail(output)
    detail(run(['node', 'test-earth.mjs'], cwd=stage, timeout=25))
    detail(run(['node', 'test-earth-map.mjs'], cwd=stage, timeout=15))
    detail(run(['node', 'test-entry.mjs'], cwd=stage, timeout=15))
    detail(run(['node', 'test-studio.mjs'], cwd=stage, timeout=15))
    # Use module discovery from the staged project root: direct execution of
    # tests/test_*.py puts tests/ (not the project root) on sys.path and breaks
    # imports such as `from backend.integrations import ...`.
    output = run(['python3', '-m', 'unittest', 'discover', '-s', 'tests',
                  '-p', 'test_*.py', '-v'], cwd=stage, timeout=60)
    if 'Ran ' not in output or 'OK' not in output:
        raise ReleaseError('Local Python test discovery did not complete successfully')
    detail(output)
    import ast
    for filename in ['backend/app.py','backend/models.py','backend/blueprints.py','backend/ai_routes.py','backend/integrations.py','tests/test_building_generation.py','scripts/release_watcher.py','tests/test_backend.py','tests/test_blueprints_unit.py','tests/test_public_assets.py','tests/test_ai.py','tests/test_auth_ui.py','tests/test_ai_setup.py','tests/test_api_console.py','tests/test_places.py','tests/test_places_ui.py','tests/test_geography_ui.py']:
        ast.parse((stage / filename).read_text(), filename=filename)
    run(['bash', '-n', 'scripts/install-ubuntu.sh'], cwd=stage, timeout=15)
    if (stage / 'scripts/install-macos-watcher.sh').is_file():
        run(['bash', '-n', 'scripts/install-macos-watcher.sh'], cwd=stage, timeout=15)
    installer=(stage / 'scripts/install-ubuntu.sh').read_text()
    watcher=(stage / 'scripts/release_watcher.py').read_text()
    if 'APPROOT=/opt/planetlab' not in installer or 'VENV_ROOT="$APPROOT/venvs"' not in installer or "APPROOT = '/opt/planetlab'" not in watcher:
        raise ReleaseError('Deployment must keep releases and virtualenvs outside the Nginx webroot')
    index = (stage / 'index.html').read_text()
    if 'collab.mjs' not in index or 'app.mjs' not in index or 'xrControls' not in index or 'id="authBackdrop"' not in index:
        raise ReleaseError('Missing required multiplayer/Three.js/XR interface entrypoints')
    detail('Local JS, planner, Python syntax, shell, frontend tests passed')


def normalize_git_ssh():
    """Fix only known Planet Lab HTTPS/SSH URL variants; never touch other repositories."""
    repo_ok = {
        GITHUB,
        'ssh://git@github.com/sylwesterdigital/planet-lab.git',
        'https://github.com/sylwesterdigital/planet-lab.git',
        'https://github.com/sylwesterdigital/planet-lab',
    }
    fetch_url = run(['git','remote','get-url','origin'], cwd=ROOT)
    if fetch_url not in repo_ok:
        raise ReleaseError('Unexpected origin URL; refusing to rewrite: ' + fetch_url)
    push_urls = subprocess.run(['git','config','--get-all','remote.origin.pushurl'],
                               cwd=ROOT,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if push_urls.returncode not in (0,1):
        raise ReleaseError('Could not examine Git push URL')
    configured = [x.strip() for x in push_urls.stdout.splitlines() if x.strip()]
    if any(x not in repo_ok for x in configured):
        raise ReleaseError('Unexpected Git push URL; refusing to overwrite: ' + ', '.join(configured))
    if fetch_url != GITHUB:
        run(['git','remote','set-url','origin',GITHUB], cwd=ROOT)
        log('Git origin automatically switched to GitHub SSH')
    if configured != [GITHUB]:
        # Explicitly replace any old HTTPS pushurl, removing extras.
        for old in configured:
            run(['git','config','--unset-all','remote.origin.pushurl'], cwd=ROOT)
            break
        run(['git','remote','set-url','--push','origin',GITHUB],cwd=ROOT)
        log('Git push remote automatically configured for SSH keys')


def git_preflight(stage, hashes):
    if not (ROOT / '.git').exists():
        raise ReleaseError('Not in cloned Git repository: ' + str(ROOT))
    branch = run(['git','branch','--show-current'],cwd=ROOT)
    if branch != 'main':
        raise ReleaseError(f'Expected main branch, found {branch}')
    normalize_git_ssh()
    staged = run(['git','diff','--cached','--name-only'],cwd=ROOT)
    if staged:
        raise ReleaseError('Existing staged changes: '+staged)
    dirty = set(run(['git','diff','--name-only'], cwd=ROOT).splitlines())
    for rel in hashes:
        target=ROOT/rel
        if target.is_symlink():
            raise ReleaseError('Refusing to overwrite symlink: '+rel)
        if rel in dirty and (not target.is_file() or target.read_bytes() != (stage/rel).read_bytes()):
            raise ReleaseError('Release conflicts with uncommitted edits: '+rel)
    run(['git','var','GIT_AUTHOR_IDENT'],cwd=ROOT)
    remote_main = run(['git','-c','core.sshCommand=ssh -o BatchMode=yes -o ConnectTimeout=10',
                       'ls-remote',GITHUB,'refs/heads/main'],cwd=ROOT,timeout=35)
    if remote_main:
        run(['git','-c','core.sshCommand=ssh -o BatchMode=yes -o ConnectTimeout=10',
             'fetch','--no-tags',GITHUB,'main'],cwd=ROOT,timeout=45)
        if subprocess.run(['git','rev-parse','--verify','HEAD'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode == 0:
            relation = subprocess.run(['git','merge-base','--is-ancestor','FETCH_HEAD','HEAD'],cwd=ROOT,
                                      stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            if relation.returncode:
                raise ReleaseError('GitHub main diverged; automatic deployment stopped to preserve history')
        else:
            raise ReleaseError('Remote main has history but local main has no commits')
    ssh('test -d /var/www/planetlab.me && command -v nginx && command -v rsync && command -v python3 && command -v curl')
    detail('GitHub SSH, working tree and Ubuntu SSH preflight passed')


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
      runuser -u planetlab -- "$VENV_PY" -m unittest discover -s tests -p 'test_*.py' -v''', timeout=70)
    if 'OK' not in output:
        raise ReleaseError('Remote backend tests were not confirmed: ' + output[-400:])
    detail('Ubuntu release staged, dependencies installed, backend tests passed. Live unchanged.')


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
             'push',GITHUB,'main'],cwd=ROOT,timeout=100)
        local=run(['git','rev-parse','HEAD'],cwd=ROOT)
        remote=run(['git','-c','core.sshCommand=ssh -o BatchMode=yes -o ConnectTimeout=10',
                    'ls-remote',GITHUB,'refs/heads/main'],cwd=ROOT,timeout=30)
        if not remote.startswith(local+'\t'):
            raise ReleaseError('GitHub did not confirm pushed commit')
    except Exception:
        # Never reset the user's working tree automatically.
        raise
    detail(f'GitHub main updated: {local[:12]}')
    return local[:12]


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
        log(f'Public smoke failed: {exc}; requesting server rollback', 'WARN')
        ssh(f'bash {remote_path(release+"/scripts/install-ubuntu.sh")} {version} rollback', timeout=90)
        raise ReleaseError('Public HTTPS verification failed; rollback attempted') from exc
    detail('HTTPS frontend and API verified; WebSocket endpoint configured in Nginx')


def process(archive, dry_run=False):
    STATE.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='release-', dir=STATE) as temp:
        stage_dir = Path(temp)
        stage('1/6 ZIP validation')
        manifest = verify(archive, stage_dir)
        version = manifest['version']
        RUN['version'] = version
        log(f'1/6  ZIP verified · {len(manifest["sha256"])} files', 'SUCCESS')

        stage('2/6 Local tests')
        local_tests(stage_dir)
        log('2/6  Local checks passed · planner + frontend + syntax', 'SUCCESS')
        if dry_run:
            detail(f'Local validation complete for v{version}; GitHub and Ubuntu unchanged.')
            return

        stage('3/6 GitHub and Ubuntu preflight')
        git_preflight(stage_dir, manifest['sha256'])
        log('3/6  GitHub SSH + Ubuntu preflight passed', 'SUCCESS')

        stage('4/6 Ubuntu staging and integration')
        deploy_stage(stage_dir, version)
        log('4/6  Ubuntu staged · backend tests passed', 'SUCCESS')

        stage('5/6 GitHub publishing')
        commit = git_publish(stage_dir, manifest)
        RUN['github'] = True
        log(f'5/6  GitHub pushed · {commit}', 'SUCCESS')

        stage('6/6 HTTPS activation and smoke test')
        activate(version)
        RUN['live'] = True
        log('6/6  HTTPS + API verified', 'SUCCESS')
        # Optional UX metadata: a failure here must not roll back a healthy release.
        try:
            ssh(f'python3 {remote_path(APPROOT+"/current/scripts/record-release.py")} {version} {commit}', timeout=15)
        except Exception as log_error:
            log(f'Deployment succeeded; release history not recorded: {_short_error(log_error)}', 'WARN')
        status = {'version': version, 'utc': dt.datetime.now(dt.timezone.utc).isoformat(),
                  'github': GITHUB, 'site': URL}
        tempstatus = STATE / 'deployed.json.tmp'
        tempstatus.write_text(json.dumps(status, indent=2) + '\n')
        tempstatus.replace(STATE / 'deployed.json')


def main():
    os.environ['GIT_TERMINAL_PROMPT'] = '0'
    parser=argparse.ArgumentParser(description='PLANETLAB versioned ZIP deployment watcher for macOS')
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument('--once',action='store_true',help='Consume pending ZIPs once then exit')
    mode.add_argument('--dry-run',action='store_true',help='Validate ZIPs locally without GitHub or server changes')
    mode.add_argument('--status',action='store_true')
    mode.add_argument('--check-zip',type=Path,metavar='FILE',help='Validate one release and exit (no Git or deploy)')
    parser.add_argument('--interval',type=int,default=4)
    parser.add_argument('--color', choices=('auto','always','never'), default='auto', help='ANSI colour mode (default: auto for TTY)')
    parser.add_argument('--verbose', action='store_true', help='Print complete subprocess/test output; normally only in release logs')
    args=parser.parse_args()
    global COLOR_MODE, VERBOSE
    COLOR_MODE = args.color
    VERBOSE = args.verbose
    if args.check_zip:
        STATE.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='zip-check-',dir=STATE) as tmp:
            manifest=verify(args.check_zip,Path(tmp))
            local_tests(Path(tmp))
            log('CHECK PASSED v'+manifest['version']+'; GitHub and server unchanged', 'SUCCESS')
        return 0
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
        log(f'Watcher ready · deployed v{get_deployed()} · monitoring updates/', 'INFO')
        detail('Watch directory: '+str(UPDATES))
        code_hash=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        failed=False
        while True:
            pending=sorted(UPDATES.glob('*.zip'))
            for archive in pending:
                if not (args.once or args.dry_run) and time.time()-archive.stat().st_mtime < 4:
                    continue
                begin_run(archive,args.dry_run)
                try:
                    process(archive,args.dry_run)
                    if not args.dry_run:
                        dest=UPDATES/'processed'/archive.name
                        if dest.exists():dest=dest.with_name(archive.stem+'-'+str(int(time.time()))+'.zip')
                        archive.rename(dest)
                    finish_run(True,args.dry_run)
                except Exception as exc:
                    failed=True
                    if not args.dry_run:
                        dest=UPDATES/'failed'/archive.name
                        if dest.exists():dest=dest.with_name(archive.stem+'-'+str(int(time.time()))+'.zip')
                        archive.rename(dest)
                        detail(f'Failed release saved at {dest}')
                    finish_run(False,args.dry_run,str(exc))
            if args.once or args.dry_run:return 1 if failed else 0
            updated=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
            if updated!=code_hash:
                log('Watcher code updated · restarting', 'INFO')
                os.execv('/bin/bash', ['bash', str(ROOT/'planetlab-watch.sh'), '--interval', str(args.interval), '--color', args.color] + (['--verbose'] if VERBOSE else []))
            time.sleep(args.interval)


if __name__=='__main__':
    try:sys.exit(main())
    except KeyboardInterrupt:log('Watcher stopped', 'WARN');sys.exit(0)
    except Exception as err:log('FATAL: '+str(err), 'ERROR');sys.exit(1)

# PLANET / LAB — v0.3.2

**Deployment correction:** App code and shared Python environments live in `/opt/planetlab`, not in `/var/www`. The v0.3.1 first deployment failed when the `planetlab` service user could not execute the release-owned `.venv/bin/python` under the web directory. The exact original permission/mount cause was not established; v0.3.2 removes that risky arrangement, checks readability and executability as `planetlab`, and prints `namei` and mount details on failure.

### Production filesystem layout

| Path | Content |
| --- | --- |
| `/var/www/planetlab.me/` | Existing public site directory (preserved). Once adopted, Nginx reverse-proxies to Gunicorn. |
| `/opt/planetlab/releases/vX.Y.Z` | Immutable versioned Flask/Three.js source; owned by root, readable by service user. |
| `/opt/planetlab/venvs/pyX.Y-HASH` | Cached Python virtualenv keyed by Python minor version and requirements hash. Reused across compatible releases. |
| `/opt/planetlab/current` | Atomic symlink to the live release; no `.venv` inside the website. |
| `/var/lib/planetlab` | Persistent SQLite, media, app data and database backups. |
| `/etc/planetlab/planetlab.env` | Server configuration and secret key; root-only. |
| `/etc/planetlab/nginx-backups/` | Original Certbot/Nginx vhost backup and explicit adoption approval (v0.3.1). |

### Install v0.3.2 after failed v0.3.1

1. Download `PLANETLAB_STARTER_v0.3.2.zip` to `~/Downloads` on Mac.
2. In the existing repository (without recloning):

   ```bash
   cd /Users/smielniczuk/Documents/works/planet-lab
   unzip -o ~/Downloads/PLANETLAB_STARTER_v0.3.2.zip -d .
   bash planetlab-watch.sh --dry-run
   bash planetlab-watch.sh --once
   ```

   Starter only refreshes the local watcher and places `PLANETLAB_RELEASE_v0.3.2.zip` into `updates/`. It should not replace other application source files. Check with `unzip -l` before extracting if you have locally modified those scripts. Leave v0.3.0 and v0.3.1 in `updates/failed`.

3. The previously approved Nginx adoption SHA remains valid **only if the existing Nginx site has not changed**. There is no need to run the approval helper again on an unchanged config.
4. The watcher stages under `/opt`, builds/reuses a venv under `/opt`, runs integration tests as `planetlab`, pushes a verified Git commit, activates the service, then performs HTTPS smoke checks. Failed preparation leaves the existing site as it was. Do not manually `chmod -R` the old release or delete the site's existing files.

**Limitations:** PostgreSQL is supported as a connection URL, but automatic schema migrations and PostgreSQL backups are not implemented. Multi-worker WebSocket scale-out remains future work. The procedural planner is not yet an LLM.

---

## Architecture

| Layer | v0.3 status |
|---|---|
| Planet → regions → settlements → plots | Procedural seeded model (`planner.mjs`) |
| Building and infrastructure construction | Three.js walking robotic avatars and staged job playback (`app.mjs`) |
| WebXR | Browser-supported immersive VR entry (`VRButton`); controllers/build actions not yet wired |
| Multiuser identity | Flask signed session cookies, password hashes, CSRF on writes |
| Saved worlds | Flask + SQLAlchemy, SQLite WAL by default; PostgreSQL URL supported |
| Realtime | Flask-Sock world chat/presence, single Gunicorn process (24 threads) |
| Media | Private per-world uploads, GLB header validation, 50 MB per file, outside source tree |
| Deployment | Mac watcher validates versioned ZIP then GitHub push and Ubuntu SSH deploy |

**Not yet implemented:** LLM-generated plans, server-authoritative robot simulation, persistent realtime simulation ticks, WebXR controllers, offline vendor-hosted Three.js, production-scale WebSocket fanout (e.g. Redis), Alembic migrations, object storage, file content antivirus scanning, payment/budget accounting, spatial collision validation. The current planner interprets briefs heuristically. Schematic terrain and buildings are not real engineering designs.

## First deployment — macOS developer workstation

Working copy: `/Users/smielniczuk/Documents/works/planet-lab`  
GitHub origin: `git@github.com:sylwesterdigital/planet-lab.git`  
Ubuntu: `ssh -p 333 root@planetlab.me`  
Release destination: `/opt/planetlab/releases/v0.3.2`  
Persisted site data: `/var/lib/planetlab`  
Site: `https://planetlab.me`

Prerequisites on Mac: `git`, `node` (18+), `python3`, `rsync`, `ssh`, GitHub SSH write access, working server SSH key. On Ubuntu: Nginx, systemd, python3 with venv/pip, curl, rsync, and internet access for pip. A **valid HTTPS certificate for planetlab.me must already exist** under `/etc/letsencrypt/live/planetlab.me/` for the public smoke check to succeed. An existing unmanaged Nginx site will **not** be overwritten; manually review/migrate its configuration first.

1. Clone (only when not already cloned):

   ```bash
   git clone git@github.com:sylwesterdigital/planet-lab.git /Users/smielniczuk/Documents/works/planet-lab
   ```

2. Extract `PLANETLAB_STARTER_v0.3.2.zip` into the cloned repository root (it provides `planetlab-watch.sh`, `scripts/release_watcher.py` and `updates/PLANETLAB_RELEASE_v0.3.2.zip`). If your repo already has local files, check for conflicts before extracting. This does **not** overwrite your code with the new application; the watcher validates and publishes it.
3. Run:

   ```bash
   cd /Users/smielniczuk/Documents/works/planet-lab
   bash planetlab-watch.sh --dry-run
   bash planetlab-watch.sh --once
   bash planetlab-watch.sh
   ```

   The last command monitors `updates/*.zip` every 4 seconds. Use one terminal session; Ctrl-C to stop. Verified releases move into `updates/processed/`; failed ones into `updates/failed/`. To retry a failed ZIP after resolving the error, move it from `failed/` into `updates/`.

4. Status: `bash planetlab-watch.sh --status`.

**Deployment order:** ZIP path/version/SHA verification → Node/planner/shell/Python syntax tests → GitHub+SSH+Nginx preflight → rsync release into `/opt/planetlab/releases/vVERSION` → Ubuntu pip and backend integration tests → GitHub commit/push → atomic `current` symlink flip and service reload → local health + public HTTPS smoke. On failed activation/public smoke, previous application and managed Nginx/service configs are restored. Persistent database/media are never deleted or overwritten; database rollback requires a separate manual decision if a future migration changes schema. GitHub may already be updated even if server activation fails; the watcher reports that failure explicitly.

**Important safety properties:** never `git reset --hard`, never rsync-delete `/var/www/planetlab.me` root, never `apt autoremove`, never wipe persistent files, no background shell installation from the app, and no automatic takeover of an unmanaged Nginx site. `--dry-run` never connects to GitHub or Ubuntu.

## PostgreSQL

Default is `sqlite:////var/lib/planetlab/planetlab.sqlite3` (WAL). To use PostgreSQL from the first deployment, provision database/user yourself and add `PLANETLAB_DATABASE_URL=postgresql+psycopg://...` in root-owned `/etc/planetlab/planetlab.env` before backend activation. Switching between DB engines later requires an explicit data migration; changing the URL will NOT migrate existing data. DB models are defined in `backend/models.py`; `create_all()` bootstraps empty schemas but does not handle future alterations. Introduce Alembic before changing deployed columns.

## Security / multiplayer limits

Do not expose Gunicorn on public interfaces: it binds to `127.0.0.1:8765`, behind HTTPS Nginx. Session cookie uses Secure/HttpOnly/SameSite=Lax, CSRF header, and WebSocket Origin verification. Passwords are hashed; registration currently open to the public. **Before inviting untrusted internet users:** add Nginx auth/registration rate limits, quotas, abuse monitoring, object upload malware scanning, image processing in a sandbox, Redis pub/sub for multiworker WebSockets, and reverse-proxy request size protections. GLB uploads are stored as downloads and not executed by the backend.

## Local development

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
export PLANETLAB_DATA_DIR="$PWD/.planetlab/local-data"
export PLANETLAB_SECRET_KEY="$(python3 -c 'import secrets;print(secrets.token_hex(48))')"
export PLANETLAB_DEV_HTTP=1 # local HTTP only; NEVER use on production server
python3 -m flask --app 'backend.app:create_app' run --port 8088
```

Open http://127.0.0.1:8088. The local-only `PLANETLAB_DEV_HTTP=1` toggle permits login cookies on HTTP; production must omit it.

Checks:

```bash
node --check app.mjs && node --check planner.mjs && node --check collab.mjs
node test-planner.mjs
python3 -m unittest discover -s tests -p 'test_backend.py'
```

## API v0.3

| Endpoint | Action |
|---|---|
| `GET /api/health` | Version + DB health |
| `GET /api/session` | CSRF token and current account |
| `POST /api/register`, `POST /api/login`, `POST /api/logout` | Session actions |
| `GET /api/worlds`, `POST /api/worlds` | List accessible worlds/create owner world |
| `GET /api/worlds/<id>`, `PUT /api/worlds/<id>` | Read/modify revisioned blueprint |
| `GET /api/worlds/<id>/messages` | Recent world chat |
| `WS /ws/world/<id>` | Presence, cursor and chat events |
| `POST /api/worlds/<id>/media`, `GET /api/worlds/<id>/media` | Upload/list world media |
| `GET /api/media/<uuid>` | Authenticated forced-attachment media download |

JSON world blueprint contains `config`, `tasks`, `landuse`, `stats` and experimental governance metadata. `plan` generation and robots remain local/authoritative in the browser; syncing complex 3D edits and authoritative multiplayer actions are planned for the next release.

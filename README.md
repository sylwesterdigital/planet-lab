# Planet Lab v0.4.3 — Auth bootstrap and deployment diagnostics

This release addresses a mixed-version browser cache failure where v0.4.0 `collab.mjs` attempted to access removed registration controls from v0.4.2 HTML, leaving the first-load overlay stuck. It does not alter persistent databases, media or the live deployment paths.

Changes:
- HTML and JavaScript modules served with `Cache-Control: no-store`; versioned script entry URLs and planner import.
- Browser auth uses the current server session as the source of truth after login and registration.
- Admin status is included in `/api/session`; regular accounts no longer produce avoidable 403 calls to `/api/integrations`. Backend permission checks remain enforced.
- Provider password fields are inside a form with submit prevention.
- Release watcher: colour-coded terminal levels, explicit start/end banners, deployment phase, elapsed time, version/GitHub/site summary, and durable logs. Colour auto-disables in redirected logs / launchd. `NO_COLOR` supported.

Workflow: drop `PLANETLAB_RELEASE_v0.4.3.zip` into `updates/`. The running watcher validates, stages, tests, pushes by SSH, deploys and verifies. No manual Git operations.

The wrapper under `planetlab-watch.sh` may be run interactively for coloured output, or installed as a persistent launchd job using `scripts/install-macos-watcher.sh` (one-time setup).

# PLANET / LAB — v0.4.2

## v0.4.2 — First-load account experience and persistent sessions

- **Registration/sign-in overlay:** The first page load queries `/api/session`. Signed-in users enter the scene immediately; unauthenticated visitors see a full-screen, keyboard-accessible account form with tabs for **Create account** and **Sign in**. The multiplayer sidebar no longer contains duplicate registration buttons or passwords.
- **Single-form validation:** Handle must be 3–32 characters (letters/numbers/`_`/`-`); registration passwords must be 12–200 characters. Backend errors appear directly on the form. Register and login both sign in automatically.
- **Session persistence:** Flask signs the session into an `HttpOnly`, `SameSite=Lax`, `Secure` (production) cookie with a rolling 30-day expiry. The browser stores **no password, CSRF token or session secret in localStorage**. Signing out clears the browser session and reopens the overlay.
- **Avoided CSRF startup race:** Studio settings now listen to the same authenticated session event as multiplayer. Two independent startup calls to `/api/session` could previously create conflicting anonymous CSRF cookies.
- **Admin is NOT automatically granted to the first public signup.** Register normally in the overlay; the server operator must separately authorise the correct account before enabling paid AI integrations. This protects the site against a random visitor claiming the first administrator account.
- **No manually executed GitHub or deployment commands per release:** With the v0.4.1 `launchd` watcher installed, drop `PLANETLAB_RELEASE_v0.4.2.zip` directly into `updates/`. The watcher validates, commits, pushes using SSH, stages and tests Ubuntu, activates and verifies the site. To enable the launchd watcher on a workstation where it has never been installed, run `bash scripts/install-macos-watcher.sh install` once.

**Verification:** Built-in frontend-auth contracts and 48 planner checks run locally. The remote watcher must still run full Flask integration tests and HTTPS smoke checks before marking a deployment successful. No remote services or GitHub accounts are changed simply by unpacking this release.

---

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

---

# Planet Lab 0.4.0 — Spatial AI Studio and 3D component foundry

This release **extends** the existing 0.3.x Three.js procedural planet, city planner, house-builder demo, robots, multiuser accounts, SQLite/PostgreSQL, WebSockets and Mac release watcher. It does not replace those modules.

## What's new

- **Building Studio:** manually edit width, depth, 1–20 floors, roof type, facade styling, windows and simple room partitions. A first-person-like interior camera inspection is provided, but there is no collision, interaction or architectural certification. Studio buildings are concept geometry overlaid on the original terrain; they do **not** alter zoning, roads or robot task scheduling.
- **Meta Muse Spark:** an admin can ask Meta to propose a JSON building specification. All dimensions are bounded and converted into deterministic THREE.BoxGeometry meshes. Generated JSON never executes code.
- **Meta Muse Image:** generate one architectural concept image per call and attach the result to an owned saved world as private media (unless the world is made public).
- **Tripo3D:** queue text-to-3D tasks; poll their status manually. Import approved-host GLB model URLs into world media and place GLBs in the scene, or use the existing manual GLB uploader if the provider uses another CDN.
- **Integrations & Models:** admin-controlled server-side API keys, model identifiers and allowlisted HTTPS API endpoints for Meta and Tripo; no keys embedded in JavaScript or the release archive.
- **Simulated analytics:** a bar chart of planned roads, residential buildings, infrastructure and protected green-space cells. This is NOT a real-world city dataset.
- **Deployment:** Git remotes must be configured to the repo's GitHub SSH URL. The watcher runs new integration tests as part of remote preparation.

## Authentication: one-time operator approval

Registration alone **never grants API billing privileges**. After a successful 0.4.0 deployment, create/sign in to the intended Planet Lab account on `https://planetlab.me/`, then authorise that existing account on Ubuntu:

```bash
ssh -tt -p 333 root@planetlab.me 'bash /opt/planetlab/current/scripts/authorize-admin.sh'
```

The helper looks up the existing account ID in the configured database, shows the binding and requires `AUTHORIZE`. It writes `PLANETLAB_ADMIN_HANDLE` and `PLANETLAB_ADMIN_USER_ID` to `/etc/planetlab/planetlab.env` with a timestamped backup and restarts only `planetlab.service`. A deployment cannot automatically elect a public registrant as billing administrator. If this command is not run, the integration configuration remains disabled by default.

In the web UI, click **Refresh authentication / settings** to reveal Integrations & Models, then enter API credentials. Meta and Tripo are **disabled until individually enabled**. The Tripo connection check validates local configuration only (no potentially charged request); the Meta test calls GET `/models` and requires network access.

## Configuration and provider boundaries

| Provider | Base URL | Model | API operation |
| --- | --- | --- | --- |
| Meta | `https://api.meta.ai/v1` | `muse-spark-1.3` | `POST /chat/completions` |
| Meta image | Same Meta key | `muse-image-1.0` | `POST /images/generations` |
| Tripo | `https://openapi.tripo3d.ai/v3` (or `.com`) | `v3.1-20260211` | `POST /generation/text-to-model`, `GET /tasks/{id}` |

Only these documented origins are available from the configuration UI. Arbitrary internal endpoints are deliberately not permitted. Provider calls are never made during app startup or deploy. They are initiated on demand by the authorised operator and may incur charges. The application does not yet implement spending limits, usage accounting, or background task workers.

**Credentials:** stored in `/var/lib/planetlab/private/integrations.json`, under `0700` parent and `0600` file permissions. Keys are **not encrypted at rest**: protect the service account, snapshots and backups, and rotate keys if compromised. They are omitted from API responses, commits and ZIP releases. Never paste keys into chat or Git.

Tripo GLB model URLs can use temporary signed CDN links. Planet Lab checks that the URL uses HTTPS and an approved host before downloading, rejects redirects and checks the GLB header/length/size. To trust an additional official Tripo CDN hostname, add the exact hostname to the operator-managed service environment as `PLANETLAB_TRIPO_ASSET_HOSTS=cdn.example.org`, then restart the service. Do not allow arbitrary domains or local IP addresses. Manual GLB import remains available. Imported assets and generated images are stored under `/var/lib/planetlab/media/`, never inside releases.

## Existing deployment workflow

Copy a new `PLANETLAB_RELEASE_v0.4.0.zip` to the Mac repository's `updates/`, then run:

```bash
cd /Users/smielniczuk/Documents/works/planet-lab
bash planetlab-watch.sh --dry-run
bash planetlab-watch.sh --once
```

The watcher stages `/opt/planetlab/releases/v0.4.0`, uses the shared requirements-keyed venv under `/opt/planetlab/venvs`, checks the backend in isolation, commits and pushes GitHub with SSH, activates systemd/Nginx, verifies public HTTPS, and rolls back the application on failed activation. It never synchronises world media or database files from the release ZIP. A new `asset_jobs` SQL table is created via existing metadata bootstrap; altering existing schemas in later releases needs Alembic migrations.

**Release watcher limitations:** server upgrade preflight can stage files and install Python packages. It does not test production credentials, Meta/Tripo paid inference, externally hosted CDN downloads, distributed WebSockets, or WebXR hardware. After deployment verify authentication, settings and a deliberately low-cost test request manually.

## World model and roadmap

Keep geography, editable geometry, AI content and economy separate. Recommended hierarchy:

`Planet → Region → City → Parcel → Building → Floor → Room → Component`

Future milestones should include: GeoJSON/OpenStreetMap/Overture parcel ingestion with source/licence/provenance, real estate visual layers, parametric building component IDs and constraint graph, room-level materials/furniture/doors, real WebXR walking interaction and manual work tools, durable asynchronous provider job queue and automated CDN ingest, spatial/transport networks, and a resource-accounting simulation with simulated rather than legal ownership. There is **no live GIS/real estate integration, world economy, structural simulation or authoritative multiplayer building** in this release.

## Local validation

```bash
node --check app.mjs
node --check studio.mjs
node test-planner.mjs
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

Full backend integration tests need packages from `backend/requirements.txt`; the watcher installs them on Ubuntu in an isolated virtual environment. New AI tests mock Meta responses and never spend API credits. Check actual provider API versions and your agreement before enabling paid calls.

---

## v0.4.1 — Always-on macOS release watcher

Planet Lab is designed for **zero manual deploy commands after one-time setup**. The watcher runs as an unprivileged `launchd` LaunchAgent (label `me.planetlab.release-watcher`) and starts at user login. While Mac is powered on and the user session is active, it scans `<repo>/updates/` every four seconds, waiting for `PLANETLAB_RELEASE_vX.Y.Z.zip`. It needs no separate `--once`, `--dry-run` or manual `git push` per release.

The one-time starter installer (`Install Planet Lab Watcher.command`) copies the verified watcher files into the cloned repository, places the initial versioned ZIP in `updates/`, performs local release checks, and registers the LaunchAgent. This step **cannot be done remotely from a chat**; the Mac user runs it once.

**Future releases**: drag the ZIP into `updates/` using Finder. The watcher verifies checksums/paths, runs tests, checks GitHub and Ubuntu access, stages a release, runs remote integration tests, commits only the release's declared files, pushes using `git@github.com:sylwesterdigital/planet-lab.git`, activates via SSH `root@planetlab.me` port `333`, verifies HTTPS and records deployment. Successful ZIPs move to `updates/processed/`; failed ZIPs move to `updates/failed/` and require diagnostics before retry. Server data/media under `/var/lib/planetlab` remain out of release sync.

Commands for occasional administration (not required for deployments):

- `bash scripts/install-macos-watcher.sh status` — see launchd service and last deployment.
- `bash scripts/install-macos-watcher.sh logs` — inspect watcher logs.
- `bash scripts/install-macos-watcher.sh stop` — stop until next user login.
- `bash scripts/install-macos-watcher.sh install` — repair/restart launchd service.

Logs: `.planetlab/logs/watcher.out.log` and `.planetlab/logs/watcher.err.log`. Deployment history: `.planetlab/deployed.json` and `updates/processed/`. SSH keys must be usable noninteractively by the macOS login session. For passphrase-protected keys, use macOS SSH agent/Keychain. Do not put private keys or API secrets inside ZIP releases. The watcher **does not deploy when the Mac is off or nobody is logged in**; untrusted ZIPs should never be put into `updates/` because release scripts are executable code.

**Note:** Checksums in the ZIP establish integrity relative to its manifest, not cryptographic authenticity of the publisher. Only accept release bundles from a trusted source. Pending failures are not silently retried to avoid repeated potentially destructive deployment attempts; inspect logs and move the verified ZIP back from `updates/failed/` to `updates/` after fixing the cause.

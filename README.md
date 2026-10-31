# PlanetLab v0.4.10 — conceptual spatial workstation

PlanetLab is a Three.js frontend with a Flask API, local world snapshots, optional
AI provider integrations, and a staged macOS-to-Ubuntu deployment workflow.
It is a **conceptual simulator**, not BIM, actual GIS, engineering analysis, cost
estimation, or a construction-ready design tool.

## Main workflows

- **Globe / City-site:** choose fictional geography and a site; generate
  a procedural settlement and inspect its task plan and schematic infrastructure.
- **Building Studio:** edit conceptual house massing (dimensions, floors, roof,
  partitions); switch between massing, site plan and schematic agent views.
- **Saved Places:** save privately by default, browse planetary geo-pins, restore
  snapshots and mark your own snapshots as favourites. Public sharing is opt-in.
- **AI Setup / API Console:** configure supported external providers using session
  or explicitly configured server credentials; third-party calls require valid keys.
- **House demo:** the original single-house assembly example remains at
  `/house/index.html`.

## Changes in v0.4.10

- Allow only known frontend assets through Flask's static route. This denies
  requests for archived releases, source/configuration, and deployment files.
- Reject malformed, non-JSON-safe and oversized blueprints, and reject non-boolean
  public/private visibility flags. Existing valid snapshots remain compatible.
- Do not reveal a public world's private favourite/star flag to other users.
- Ignore malformed saved anchor and site coordinates before restoring terrain.
- Refresh snapshot state after a revision conflict; display release-note dates
  and multi-item change lists correctly.
- Add regression cases for privacy, public assets and blueprint validation.

## Local tests

```sh
node test-planner.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

Python integration tests require installing `backend/requirements.txt`. If Flask
or flask-sock is missing, those tests are explicitly **skipped**, not passed.
Run all tests with dependencies on the staging server before activating a release.

## Deployment

The watcher accepts `PLANETLAB_RELEASE_v0.4.10.zip` in the Mac repository's
`updates/` directory. It validates manifest hashes, runs local and staged tests,
pushes through configured Git SSH, and activates the Ubuntu version with rollback
checks. **Placing a ZIP there initiates deployment**; review its changes first.
Never copy `.planetlab/`, `.git/`, old `updates/`, credentials, or database files
into publicly served assets. Persistent application data belongs outside the
immutable release directory (normally `/var/lib/planetlab`).

This workspace copy and its release archive do not deploy or modify any live
server automatically. Refer to `scripts/install-macos-watcher.sh` and
`scripts/install-ubuntu.sh` for existing production setup.

# PlanetLab v0.4.13 — conceptual spatial workstation

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

## Changes in v0.4.13

- Fix Building Studio preview not appearing: add the generated model to a visible
  Three.js studio group in regional view. The model is removed on site changes,
  retains metre scale, and the camera frames the generated model.
- Use Meta's documented Chat Completions `json_schema` response mode with a
  controllable reasoning effort and larger output-token limit. A response with
  `finish_reason=length` and `content=null` is treated as a clear provider
  error. Do not fabricate AI output or repeat paid calls automatically.
- Surface AI errors in Building Studio rather than opening API Console, prevent
  duplicate clicks while generating, and show the actual concept dimensions,
  area, room count and site-slope warning prominently.
- The design is **editable 3D massing**, not a generated permit plan or
  accessibility certification. Building generation still needs actual GIS,
  physical site surveys, compliance and reliable utilities to become a real
  engineering/planning workflow.
- Add an offline Building Studio scene test and Meta truncation/schema tests.

## Changes in v0.4.12

- One seeded spherical elevation model underlies the globe and the 1.56 km local
  district. Clicking a rotating globe uses local (not world) coordinates.
  The procedural geography is **not Earth data** or a measured DEM.
  One scene unit represents 10m locally; building studio dimensions remain metres.
- Existing geo-pins show saved-site labels; selecting one directly loads the
  saved plan. Old v1 plans keep their saved task coordinates and statuses.
- The settlement planner now screens coastal exposure, gradients, connected
  road corridors and direct parcel access. Flood-prone or disconnected sites
  are excluded instead of being filled with a decorative city grid.
- Budget-gated conceptual connections for power, water, sewer and stormwater
  include explicit warnings: no operator capacities, hydrology, permitting,
  geotechnical conditions or market costs have been validated.
- Remove automatic large-scale infrastructure (airport, rail, stadium) that
  could not plausibly be justified on a local district tile.

## Changes in v0.4.11

- Provide a persistent start-here panel explaining the fictional globe and project goals.
- Greet the verified signed-in user without a welcome modal or lost navigation.
- Keep AI setup closed on entry; request provider keys only for explicitly chosen AI actions.
- Keep the globe unobscured and existing city/building/save workflows operational.

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
node test-entry.mjs
node test-studio.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

Python integration tests require installing `backend/requirements.txt`. If Flask
or flask-sock is missing, those tests are explicitly **skipped**, not passed.
Run all tests with dependencies on the staging server before activating a release.

## Deployment

The watcher accepts `PLANETLAB_RELEASE_v0.4.13.zip` in the Mac repository's
`updates/` directory. It validates manifest hashes, runs local and staged tests,
pushes through configured Git SSH, and activates the Ubuntu version with rollback
checks. **Placing a ZIP there initiates deployment**; review its changes first.
Never copy `.planetlab/`, `.git/`, old `updates/`, credentials, or database files
into publicly served assets. Persistent application data belongs outside the
immutable release directory (normally `/var/lib/planetlab`).

This workspace copy and its release archive do not deploy or modify any live
server automatically. Refer to `scripts/install-macos-watcher.sh` and
`scripts/install-ubuntu.sh` for existing production setup.

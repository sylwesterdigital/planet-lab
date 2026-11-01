# PlanetLab v0.4.15 — real Earth terrain exploration and release verification

The default globe is now **Earth**: MapLibre GL renders actual
OpenStreetMap cartography via OpenFreeMap with Mapterhorn elevation tiles.
No API key is required for this initial stack; both services operate as
public, best-effort providers. Their data must be attributed on the map.

## Release pipeline correction (v0.4.15)

The prior v0.4.14 archive was **rejected by Mac watcher local tests before any
changes reached GitHub or Ubuntu**. A new test file directly imported `backend`
while being launched by path (`python3 tests/test_building_generation.py`),
which excludes the repository root from Python's import search path.
The watcher now invokes the full test suite with `python3 -m unittest discover`
from the staged project directory, identical to how the Ubuntu preflight
runs it. The building test also works directly, and a regression test checks
both paths. No changes to live database layout or deployment architecture.

## Earth functionality included from the rejected v0.4.14


- **Real Earth globe and actual places:** zoom/rotate an OpenStreetMap-powered
  globe. Selecting a location stores real WGS84 latitude and longitude.
- **Actual local topography:** the 1.56 km local Three.js district is sampled
  from Mapterhorn Terrarium DEM raster tiles (512 px, zoom 12). The city
  planner uses the same sampled elevations; no procedural fallback is permitted
  when new Earth terrain fails to load. DEM is **not** a soil, parcel,
  geohazard or permitted-development dataset. 10 m per local scene unit.
- **Saved locations:** newly created Earth snapshots include `geoSource:
  earth-dem` and real anchor coordinates. The original fictional snapshots
  remain loadable in their original legacy simulation and **are not** drawn
  as misleading Earth pins. Their simulated coordinates have no safe
  automatic conversion to Earth addresses.
- **Interface:** the globe and three entry actions replace the lengthy
  first-run instruction wall. Empty city telemetry is hidden on the globe.
- **No surprise provider charges:** OpenFreeMap and Mapterhorn currently
  need no API key. Optional high-resolution satellite imagery, more reliable production geocoding,
  building footprints and jurisdiction-specific data are separate layers.

**Limitations:** Real DEM may be coarse (zoom 12 globally), and coastline
and inland water classification is approximate. The city generator's road,
parcel, utility and cost data remain illustrative; no flood-risk or
regulatory claims should be derived from elevation alone. MapLibre and
DEM tiles are live online dependencies, so a provider outage can prevent
loading a new Earth site. The visual transition is from MapLibre globe to a
Three.js terrain mesh derived from those same DEM samples; it is not yet an
orthophoto-textured scene. Verify MapLibre's CDN and elevation-tile access
in the browser before production rollout.

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
node test-earth.mjs
node test-earth-map.mjs
node test-entry.mjs
node test-studio.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

Python integration tests require installing `backend/requirements.txt`. If Flask
or flask-sock is missing, those tests are explicitly **skipped**, not passed.
Run all tests with dependencies on the staging server before activating a release.

## Deployment

The watcher accepts `PLANETLAB_RELEASE_v0.4.15.zip` in the Mac repository's
`updates/` directory. It validates manifest hashes, runs local and staged tests,
pushes through configured Git SSH, and activates the Ubuntu version with rollback
checks. **Placing a ZIP there initiates deployment**; review its changes first.
Never copy `.planetlab/`, `.git/`, old `updates/`, credentials, or database files
into publicly served assets. Persistent application data belongs outside the
immutable release directory (normally `/var/lib/planetlab`).

This workspace copy and its release archive do not deploy or modify any live
server automatically. Refer to `scripts/install-macos-watcher.sh` and
`scripts/install-ubuntu.sh` for existing production setup.

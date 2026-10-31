# PlanetLab v0.4.9 — usable spatial workstation

A corrective release, **not** an engineering-grade building simulator. Left-hand tools remain visible; the 3D stage fills the available browser height without page-level scrolling. The top workflow navigation exposes Globe, City/site, Building, Saved Places and Analysis. Building controls remain on the right. The stage has **3D massing**, **Site plan** (top-down) and **Show agents** (schematic construction rovers); landscape vegetation is optional. The old humanoid robot meshes no longer appear by default. Geometry, budgets and zoning remain conceptual and MUST NOT be treated as BIM, architectural drawings, real costs or buildable design.

**Workflow:** Open Globe → click region → City/site → choose profile and budget → Generate masterplan → switch Site plan or massing → Building Studio to edit house dimensions → Save snapshot. Output is conceptual and procedural, not real-world engineering.

**Deploy:** drop `PLANETLAB_RELEASE_v0.4.9.zip` into Mac watcher `updates/`; it will validate, test, push over Git SSH and deploy to Ubuntu without extra commands.

# PlanetLab v0.4.9 — Task-first workspace

**Deploy:** Drop `PLANETLAB_RELEASE_v0.4.9.zip` into the existing Mac watcher `updates/` directory. No manual SSH or Git commands.

## Main flows

- **Plan a settlement:** generates and constructs a procedural city with roaming robot teams.
- **Build a house:** creates a parametric conceptual building; width, depth, floors, roof and partitions are editable in Building Studio.
- **Explore the planet:** choose terrain geography and a site.
- **Saved places:** create per-account geo-pinned snapshots, revisit and star them.
- **Inspect:** view simulated statistics, infrastructure tasks and dependencies.
- **AI Setup:** existing Meta and Tripo connectors and API console; requires provider keys.

Default world is intentionally empty; nothing is constructed without an explicit action.

**Honest scope:** fictional geography, conceptual geometry, procedural rules, simple collision-free robots. No traffic, economy, building physics, real GIS, real supplier costs or realistic interior walk controls. Real-world construction suitability is NOT validated.

## Developer / deployment

Uses Three.js on the frontend and Flask API with persistent world storage, optional PostgreSQL and one-process WebSockets. Immutable package manifests, local regression checks and staged Ubuntu activation via `planetlab-watch.sh`. Full regression suite is run by watcher on Ubuntu before activation.

# PlanetLab v0.4.9 — Geo pins, city systems and compact UI

**Deployment:** place `PLANETLAB_RELEASE_v0.4.9.zip` in the Mac repository's `updates/` directory. The running watcher validates, tests, publishes to GitHub over SSH and activates the Ubuntu release. No manual Git actions.

## Changed

- Compact **PlanetLab** name/version, GitHub link, and dated release notes menu (`updates.json` is source release history, not live deploy timestamps).
- AI Console `−` minimise / `+` restore; 6–26 px fonts in 1 px increments; existing redacted API inspector remains available.
- WebXR immersive-VR entry only when `navigator.xr.isSessionSupported('immersive-vr')` succeeds, centred in the 3D stage. No VR button in the left sidebar.
- Save named snapshot = create a **new persistent world** (original snapshots remain intact). Fictional planet coordinate + seed is stored in the blueprint. Current-region / all-planet / favourites filters; click planet pin or Open to restore snapshots. Starred snapshots use an owner-only CSRF-protected PATCH endpoint with revision concurrency.
- Click an installed 3D building, assign a functional type and a code name. The metadata is preserved in the next blueprint snapshot. The selectable catalogue contains residential, commercial, civic, transport, industry, environment and utility types.
- Conceptual service/dependency checker: roads, transport, power, schools, civic services, green-space warnings and **unitless** infrastructure index.
- Existing user sessions, AI setup, Tripo import, city simulation, single-house demo, WebSockets, databases, rollback and watcher are retained.

## Architecture and honesty

- Geo coordinates are **fictional planet angular coordinates**, not WGS84 Earth GIS.
- City costs and dependency analysis are toy simulations; **not** certified engineering, actual supplier quotes or real estate valuations.
- Role tags are metadata for existing geometric shells. A hospital code name does not magically generate a fully fitted hospital.
- External OpenStreetMap / Overture / supplier API integration, simulation of real finance, ownership and WebXR hand interaction are **future work**.
- No destructive SQL migration is needed. Star + code metadata are stored in existing SQLAlchemy world JSON, and retained across releases in `/var/lib/planetlab`.

## Roadmap

1. Planet/region/city/district persistent IDs; authoritative real map tiles with source metadata and licensing.
2. Parcel-level zoning, buildings with rooms and modular real-world supplier components (dimensions, SKU, price/date/currency, licence).
3. Transport graphs (roads, rail, airports, ports), water/power/sewage networks; capacity-aware dispatch and robot team dependencies.
4. Services coverage and construction economy: hospital and fire response, equipment, inventory, labour, debt/rent, lifecycle costs, realistic time steps; clearly tagged model assumptions.
5. Marketplace of licensed components and developer/operator roles; server-authoritative multiplayer and collaborative WebXR tools.

## Tests

`node test-planner.mjs && python3 -m unittest discover -s tests -p 'test_*.py'`

The Mac watcher runs JS syntax, planner tests and frontend tests locally, then Flask integration tests on the Ubuntu staged release before activation. Live server and provider calls are not verified by the ZIP authoring environment.

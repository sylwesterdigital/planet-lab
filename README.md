# Planet Lab v0.4.6 — inspectable AI connections + quiet release output

This release adds a detachable-style floating **API Console** that is draggable by its title bar, resizable at the lower-right corner, and available from the top account strip, Building Studio and AI Setup overlay. It captures the last 100 Meta/Tripo requests **in this browser tab only**.

## Use

1. Log in, open **AI Setup**, paste your Meta API key and select a model.
2. Click **Test & show logs**. The API Console opens automatically and lists the request with status, duration, endpoint and request/response JSON.
3. Select a request to inspect upstream Meta/Tripo HTTP status, request JSON and response/error excerpt. The diagnostic payload is attached **only** when the browser explicitly sends `X-PlanetLab-Debug: 1` and the session is authenticated.
4. Move the console by dragging its title bar; resize from its lower-right corner. Use **A+ / A-**, **Errors only**, **Copy selected**, **Export JSON**, or **Clear**.
5. Use **Generate building** in Building Studio: the same panel traces every AI call.

### Security

* API keys and CSRF tokens are **never written** into console entries or exported JSON. Authorization headers are redacted. Diagnostic traces only exist in the live browser tab, and the Flask request context; no persistent diagnostic database is created.
* The upstream trace is a **bounded and redacted excerpt** of the actual provider JSON response, not a packet capture. This allows debugging 400/401/403/429/model errors without exposing authentication secrets or enormous generated images.
* Browser console exports can still include your building prompts and model outputs. Treat downloaded exports as private project information.
* Meta requests are explicitly initiated by the user and may incur provider charges. No external API calls happen during tests or installation.

### Deployment watcher

The watcher now shows a compact START line, six short success lines and one clearly coloured SUCCESS/FAILED end line. Full test output and SSH command diagnostics remain under `.planetlab/logs/`, so ordinary terminal output is not flooded with blue banners or test-runner output. `--verbose` is available when needed; normal releases require **only** dropping this ZIP into `updates/`.

### Scope

No schema migration or change to stored media. Meta/Tripo provider endpoints and credentials remain separately configured. Frontend and backend tests run before GitHub push and Ubuntu activation.

"""Operator-controlled AI providers. Keys never leave server-side storage.

No arbitrary URL fetching: endpoints are restricted to documented provider origins.
Provider calls are opt-in and not performed by the release watcher.
"""
import json
import os
import re
import threading
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

SETTINGS_LOCK = threading.RLock()
DEFAULTS = {
    'meta': {'base_url': 'https://api.meta.ai/v1', 'model': 'muse-spark-1.3',
             'image_model': 'muse-image-1.0', 'complex_model': '',
             'segmentation_model': 'sam-3.1', 'voice_model': 'muse-voice-transcribe-1.0', 'enabled': False},
    'tripo': {'base_url': 'https://openapi.tripo3d.ai/v3', 'model': 'v3.1-20260211',
              'enabled': False},
}
ALLOWED_BASES = {
    'meta': {'https://api.meta.ai/v1'},
    'tripo': {'https://openapi.tripo3d.ai/v3', 'https://openapi.tripo3d.com/v3'},
}


class IntegrationError(Exception):
    pass


def path_for(data_dir):
    return Path(data_dir) / 'private' / 'integrations.json'


def load(data_dir):
    with SETTINGS_LOCK:
        path = path_for(data_dir)
        stored = json.loads(path.read_text()) if path.exists() else {}
        result = {}
        for key, defaults in DEFAULTS.items():
            result[key] = {**defaults, **stored.get(key, {})}
        return result


def public_settings(data_dir):
    all_settings = load(data_dir)
    return {name: {**{k: v for k, v in values.items() if k != 'api_key'},
                   'configured': bool(values.get('api_key'))}
            for name, values in all_settings.items()}


def update(data_dir, name, value):
    if name not in DEFAULTS or not isinstance(value, dict):
        raise IntegrationError('Unknown integration')
    if set(value) - {'api_key', 'base_url', 'model', 'image_model', 'complex_model', 'segmentation_model', 'voice_model', 'enabled'}:
        raise IntegrationError('Unexpected integration parameter')
    with SETTINGS_LOCK:
        values = load(data_dir)
        provider = dict(values[name])
        if 'base_url' in value:
            base = str(value['base_url']).strip().rstrip('/')
            if base not in ALLOWED_BASES[name]:
                raise IntegrationError('Endpoint must be an approved provider HTTPS origin')
            provider['base_url'] = base
        for field in ('model', 'image_model', 'complex_model', 'segmentation_model', 'voice_model'):
            if field in value:
                field_value = str(value[field]).strip()
                if not (field_value == '' and field in ('complex_model', 'segmentation_model', 'voice_model')) and not re.fullmatch(r'[a-zA-Z0-9._-]{2,80}', field_value):
                    raise IntegrationError('Invalid model ID')
                provider[field] = field_value
        if 'enabled' in value:
            if type(value['enabled']) is not bool:
                raise IntegrationError('enabled must be boolean')
            provider['enabled'] = value['enabled']
        if 'api_key' in value:
            secret = str(value['api_key']).strip()
            if secret and not (12 <= len(secret) <= 4096 and '\n' not in secret):
                raise IntegrationError('Invalid API key length')
            if secret:
                provider['api_key'] = secret
        values[name] = provider
        path = path_for(data_dir)
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(path.parent, 0o700)
        import tempfile
        fd, tempname = tempfile.mkstemp(prefix='.integrations-', dir=path.parent)
        try:
            with os.fdopen(fd, 'w') as stream:
                os.fchmod(stream.fileno(), 0o600)
                json.dump(values, stream, indent=2)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(tempname, path)
            os.chmod(path, 0o600)
        finally:
            if os.path.exists(tempname):
                os.unlink(tempname)
        return public_settings(data_dir)[name]


def required(data_dir, name):
    p = load(data_dir)[name]
    if not p['enabled'] or not p.get('api_key'):
        raise IntegrationError(f'{name} is not configured and enabled')
    if p['base_url'] not in ALLOWED_BASES[name]:
        raise IntegrationError('Provider endpoint is not on the allowed list')
    return p


def provider_request(settings, endpoint, payload=None, timeout=65):
    # Paths are application-defined, never user-provided.
    base = settings['base_url']
    if not any(base in values for values in ALLOWED_BASES.values()):
        raise IntegrationError('Endpoint denied')
    if not endpoint.startswith('/') or '..' in endpoint or '?' in endpoint:
        raise IntegrationError('Invalid provider route')
    url = base + endpoint
    body = json.dumps(payload).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(url, body,
        headers={'Authorization': 'Bearer ' + settings['api_key'],
                 'Content-Type': 'application/json', 'Accept': 'application/json'},
        method='POST' if payload is not None else 'GET')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=timeout) as response:
            raw = response.read(12 * 1024 * 1024 + 1)
            if len(raw) > 12 * 1024 * 1024:
                raise IntegrationError('Provider response exceeded size limit')
            return json.loads(raw)
    except urllib.error.HTTPError as exc:
        # Never return raw provider payload: it can contain account details.
        raise IntegrationError(f'Provider HTTP {exc.code}') from exc
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise IntegrationError('Provider request unavailable or invalid') from exc


def parse_building(text):
    """Translate non-trusted model output into a bounded geometry specification."""
    if not isinstance(text, str) or len(text) > 30000:
        raise IntegrationError('Invalid model output')
    candidate = text.strip()
    if candidate.startswith('```'):
        candidate = re.sub(r'^```(?:json)?\s*', '', candidate)
        candidate = re.sub(r'\s*```$', '', candidate)
    if not candidate.startswith('{'):
        start, end = candidate.find('{'), candidate.rfind('}')
        if start < 0 or end <= start:
            raise IntegrationError('Model did not return a JSON building')
        candidate = candidate[start:end+1]
    try:
        raw = json.loads(candidate)
    except (TypeError, ValueError) as exc:
        raise IntegrationError('Model returned invalid JSON') from exc
    if not isinstance(raw, dict):
        raise IntegrationError('Expected a building object')
    def numeric(name, minimum, maximum, default, integer=False):
        try:
            value = float(raw.get(name, default))
        except (TypeError, ValueError):
            raise IntegrationError('Invalid dimension: ' + name)
        import math
        if not math.isfinite(value):
            raise IntegrationError('Nonfinite dimension')
        value = max(minimum, min(maximum, value))
        return int(round(value)) if integer else round(value, 2)
    style = str(raw.get('style', 'modern')).lower()
    roof = str(raw.get('roof', 'flat')).lower()
    return {'name': str(raw.get('name', 'Concept building'))[:80],
            'width': numeric('width', 3, 30, 10),
            'depth': numeric('depth', 3, 30, 8),
            'floors': numeric('floors', 1, 20, 2, True),
            'floorHeight': numeric('floorHeight', 2.3, 5, 3),
            'style': style if style in {'modern','industrial','rustic','futuristic','traditional'} else 'modern',
            'roof': roof if roof in {'flat','gable','shed'} else 'flat',
            'windowsPerSide': numeric('windowsPerSide', 1, 9, 3, True),
            'interiorRooms': numeric('interiorRooms', 1, 16, 4, True),
            'material': str(raw.get('material','concrete'))[:60],
            'units': 'm', 'source': 'ai-proposal',
            'editable': True, 'engineeringVerified': False}


def build_prompt(brief):
    return ("Return ONLY one valid JSON object for an imaginative but geometrically plausible "
            "parametric building. Keys: name, width (metres), depth (metres), floors, "
            "floorHeight (metres), roof (flat/gable/shed), style "
            "(modern/industrial/rustic/futuristic/traditional), windowsPerSide, "
            "interiorRooms, material. No narrative or markdown. "
            "Do not output code, URLs or unsafe commands. This is concept geometry, "
            "not an engineering blueprint. User brief: " + brief[:1800])


def extract_chat_text(result):
    return result['choices'][0]['message']['content']

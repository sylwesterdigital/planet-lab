"""Opt-in read-only credential checks; no billed generation and no key persistence."""
import json
import urllib.error
import urllib.request
from flask import abort, jsonify, request

CHECK_URLS = {
    'meta': 'https://api.meta.ai/v1/models',
    'xai': 'https://api.x.ai/v1/models',
    'openai': 'https://api.openai.com/v1/models',
    'tripo': 'https://openapi.tripo3d.ai/v3/account/balance',
}
HEADERS = {p: 'X-PlanetLab-' + ('XAI' if p == 'xai' else 'OpenAI' if p == 'openai' else p.title()) + '-Key'
           for p in CHECK_URLS}


def check_key(provider, key):
    if provider not in CHECK_URLS:
        raise ValueError('Unsupported provider')
    if not 12 <= len(key) <= 4096 or any(c.isspace() for c in key):
        raise ValueError('Invalid credential format')
    req = urllib.request.Request(CHECK_URLS[provider], method='GET',
                                 headers={'Authorization': 'Bearer ' + key,
                                          'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=14) as response:
            body = response.read(200000)
        data = json.loads(body)
    except urllib.error.HTTPError as error:
        # Never return raw body: provider may echo submitted credentials.
        return {'ok': False, 'status': 'rejected', 'http_status': error.code,
                'usage': 'Not available from this check'}
    except (urllib.error.URLError, TimeoutError):
        return {'ok': False, 'status': 'unreachable', 'usage': 'Not available from this check'}
    except (ValueError, UnicodeError):
        return {'ok': False, 'status': 'invalid_response', 'usage': 'Not available from this check'}
    if provider == 'tripo':
        account = data.get('data') if isinstance(data, dict) else None
        if not isinstance(account, dict) or data.get('code') != 0:
            return {'ok': False, 'status': 'unverified', 'usage': 'Provider returned no verified balance'}
        return {'ok': True, 'status': 'verified', 'balance': account.get('balance'),
                'frozen': account.get('frozen'), 'usage': 'Tripo API credits'}
    models = data.get('data') if isinstance(data, dict) else None
    if not isinstance(models, list):
        return {'ok': False, 'status': 'unverified', 'usage': 'Model list unavailable'}
    models_ids = [item.get('id') for item in models if isinstance(item, dict) and isinstance(item.get('id'), str)]
    return {'ok': True, 'status': 'verified_model_list', 'model_count': len(models_ids),
            'image_model_visible': ('grok-imagine-image-2.0' in models_ids if provider == 'xai' else
                                    'gpt-image-2' in models_ids if provider == 'openai' else None),
            'usage': 'Billing and token balances require provider account permissions'}


def setup_provider_checks(app, db_session, actor, require_csrf):
    @app.post('/api/ai/provider-check/<provider>')
    def provider_check(provider):
        require_csrf()
        with db_session() as db:
            if not actor(db):
                abort(401)
        if provider not in CHECK_URLS:
            return jsonify(error='Unsupported provider'), 400
        key = request.headers.get(HEADERS[provider], '').strip()
        try:
            result = check_key(provider, key)
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(provider=provider, **result), 200 if result['ok'] else 502

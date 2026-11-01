"""User-triggered, BYOK image-to-image edits for georeferenced design overlays.

Each request makes one paid provider call. Original tiles and DEM are never modified.
No API keys, edited imagery, or user prompts are stored by this route.
"""
import base64
import binascii
import json
import re
import urllib.error
import urllib.request

from flask import abort, jsonify, request

MAX_SOURCE_BYTES = 2_500_000
MAX_OUTPUT_BYTES = 9_000_000
PROVIDERS = {
    'meta': ('https://api.meta.ai/v1/images/edits', 'muse-image-1.0', 'X-PlanetLab-Meta-Key'),
    'xai': ('https://api.x.ai/v1/images/edits', 'grok-imagine-image-2.0', 'X-PlanetLab-XAI-Key'),
    'openai': ('https://api.openai.com/v1/images/edits', 'gpt-image-2', 'X-PlanetLab-OpenAI-Key'),
}


class ImageEditError(ValueError):
    pass


def decode_data_image(uri, limit=MAX_SOURCE_BYTES):
    if not isinstance(uri, str):
        raise ImageEditError('A PNG, JPEG or WebP input image is required.')
    match = re.fullmatch(r'data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)', uri)
    if not match or len(match.group(2)) > (limit * 4 // 3 + 12):
        raise ImageEditError('The source image must be PNG, JPEG or WebP, within the size limit.')
    try:
        data = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ImageEditError('Invalid base64 image data.') from exc
    mime = match.group(1)
    valid = (mime == 'png' and data.startswith(b'\x89PNG\r\n\x1a\n') or
             mime == 'jpeg' and data.startswith(b'\xff\xd8\xff') or
             mime == 'webp' and data.startswith(b'RIFF') and data[8:12] == b'WEBP')
    if not valid or not 64 <= len(data) <= limit:
        raise ImageEditError('Invalid image content or file size.')
    return data, mime


def provider_payload(provider, prompt, source, size=1024, width=None, height=None, mode='plan'):
    if mode == 'perspective':
        instruction = ('Edit this exact perspective view crop. Preserve the original camera angle, '
                       'scene perspective, building proportions, and the visible spatial layout. '
                       'Do not add text, symbols, borders, or legends. '
                       'This is a visual design concept, not a photogrammetric survey. Edit instruction: ' + prompt)
    else:
        # Preserve the planimetric footprint: output is a visual concept, not GIS edits.
        instruction = ('Edit this exact top-down satellite/orthophoto patch. Preserve the original '
                       'view orientation, scale, boundaries, road alignments outside the requested edit, '
                       'and perspective. Do not add text, symbols, borders, or legends. '
                       'This is a visual planning scenario, not a map survey. Edit instruction: ' + prompt)
    model = PROVIDERS[provider][1]
    width = int(width or size)
    height = int(height or size)
    ratio = f'{width}:{height}'
    if provider == 'xai':
        return {'model': model, 'prompt': instruction, 'image': {'url': source, 'type': 'image_url'},
                'aspect_ratio': ratio, 'resolution': '2k' if max(width, height) > 1024 else '1k',
                'quality': 'medium', 'response_format': 'b64_json'}
    if provider == 'meta':
        # No provider-independent high-res option documented for this model.
        return {'model': model, 'prompt': instruction, 'images': [{'image_url': source}], 'n': 1}
    return {'model': model, 'prompt': instruction, 'images': [{'image_url': source}],
            'n': 1, 'size': f'{width}x{height}', 'quality': 'high'}


def extract_provider_image(body):
    items = body.get('data') if isinstance(body, dict) else None
    if not isinstance(items, list) or not items or not isinstance(items[0], dict):
        raise ImageEditError('Image provider returned no usable image.')
    item = items[0]
    encoded = item.get('b64_json')
    if isinstance(encoded, str):
        if len(encoded) > MAX_OUTPUT_BYTES * 4 // 3 + 12:
            raise ImageEditError('Provider image exceeds the maximum size.')
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise ImageEditError('Provider returned invalid image data.') from exc
        detected = ('png' if raw.startswith(b'\x89PNG\r\n\x1a\n') else
                    'jpeg' if raw.startswith(b'\xff\xd8\xff') else
                    'webp' if raw.startswith(b'RIFF') and raw[8:12] == b'WEBP' else None)
        if not detected or len(raw) > MAX_OUTPUT_BYTES:
            raise ImageEditError('Provider returned an unsupported or oversized image.')
        return 'data:image/' + detected + ';base64,' + encoded
    # Never fetch arbitrary provider-provided URLs from the server (SSRF).
    if item.get('url'):
        raise ImageEditError('Provider returned a temporary URL, not image bytes; select a model supporting base64 output.')
    raise ImageEditError('Provider response contained no image bytes.')


def call_provider(provider, key, payload):
    url, _, _ = PROVIDERS[provider]
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'),
                                 headers={'Authorization': 'Bearer ' + key,
                                          'Content-Type': 'application/json',
                                          'Accept': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=115) as resp:
            # Bounded response, including base64 overhead.
            data = resp.read(MAX_OUTPUT_BYTES * 4 // 3 + 65536)
        result = json.loads(data)
    except urllib.error.HTTPError as exc:
        # Do not reflect upstream request details or headers containing credentials.
        raise ImageEditError(f'{provider} image edit rejected (HTTP {exc.code}). Verify key, model access and billing.') from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise ImageEditError(f'{provider} image edit timed out or could not connect.') from exc
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
        raise ImageEditError(f'{provider} image edit returned an invalid response.') from exc
    return extract_provider_image(result)


def setup_scenario_edits(app, db_session, actor, require_csrf):
    @app.post('/api/ai/scenario-edit')
    def scenario_image_edit():
        require_csrf()
        with db_session() as db:
            if not actor(db):
                abort(401)
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify(error='Invalid image edit request.'), 400
        provider = body.get('provider')
        if provider not in PROVIDERS:
            return jsonify(error='Choose Meta, xAI or OpenAI.'), 400
        prompt = body.get('prompt')
        if not isinstance(prompt, str) or not 4 <= len(prompt.strip()) <= 1500:
            return jsonify(error='Enter an edit prompt (4–1500 characters).'), 400
        key = request.headers.get(PROVIDERS[provider][2], '').strip()
        if not 12 <= len(key) <= 4096 or any(c.isspace() for c in key):
            return jsonify(error='Enter a valid '+provider+' API key for this tab.'), 400
        size = body.get('size', 1024)
        if size not in (1024, 1536, 2048):
            return jsonify(error='Choose 1024, 1536 or 2048 for the AI patch size.'), 400
        width = body.get('width', size)
        height = body.get('height', size)
        if not all(isinstance(v, int) for v in (width, height)) or min(width, height) < 256 or max(width, height) > 2048:
            return jsonify(error='Invalid output image dimensions.'), 400
        mode = body.get('mode', 'plan')
        if mode not in ('plan', 'perspective'):
            return jsonify(error='Unknown image-edit mode.'), 400
        try:
            # The image is a crop of the user-selected patch; no arbitrary URL input.
            source = body.get('image')
            decode_data_image(source)
            payload = provider_payload(provider, prompt.strip(), source, size, width, height, mode)
            image = call_provider(provider, key, payload)
            return jsonify(image=image, provider=provider, model=PROVIDERS[provider][1],
                           note='Visual mockup only; no real buildings or GIS data changed.')
        except ImageEditError as exc:
            return jsonify(error=str(exc)), 502 if 'provider' in str(exc).lower() or 'returned' in str(exc).lower() else 400

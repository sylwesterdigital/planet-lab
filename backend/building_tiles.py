"""Bounded, same-origin OpenStreetMap vector tile access for local 3D buildings.

Only fixed OpenFreeMap tile coordinates are accepted; this is not a general URL proxy.
The map renderer uses the same open OSM-derived dataset. No buildings are fabricated.
"""
from collections import OrderedDict
import threading
import time
import urllib.error
import urllib.request

UPSTREAM = 'https://tiles.openfreemap.org/planet/latest/{z}/{x}/{y}.pbf'
MAX_TILE_BYTES = 2_500_000
CACHE_LIMIT = 192
CACHE_SECONDS = 3600
_cache = OrderedDict()
_lock = threading.RLock()


def load_tile(z, x, y, opener=None):
    if not isinstance(z, int) or z != 14 or not isinstance(x, int) or not isinstance(y, int) or not (0 <= x < 2**z) or not (0 <= y < 2**z):
        raise ValueError('Invalid vector tile coordinates.')
    opener = opener or urllib.request.urlopen
    key = (z, x, y)
    with _lock:
        record = _cache.get(key)
        if record and record[0] > time.monotonic():
            _cache.move_to_end(key)
            return record[1]
        if record:
            _cache.pop(key, None)
    url = UPSTREAM.format(z=z, x=x, y=y)
    req = urllib.request.Request(url, headers={
        'Accept': 'application/x-protobuf,application/vnd.mapbox-vector-tile,application/octet-stream',
        'User-Agent': 'PlanetLab/0.4.36 (planetlab.me; OSM building viewer)',
        'Accept-Encoding': 'identity',
    })
    with opener(req, timeout=9) as remote:
        raw = remote.read(MAX_TILE_BYTES + 1)
        if len(raw) > MAX_TILE_BYTES:
            raise ValueError('OpenStreetMap tile exceeds size limit.')
    # Some tile CDNs return gzip-encoded MVT bytes despite identity negotiation.
    # Expand with a strict decompressed-size cap.
    if raw.startswith(b'\x1f\x8b'):
        import zlib
        inflater = zlib.decompressobj(16 + zlib.MAX_WBITS)
        raw = inflater.decompress(raw, MAX_TILE_BYTES + 1)
        if len(raw) > MAX_TILE_BYTES or not inflater.eof:
            raise ValueError('OpenStreetMap tile expanded beyond size limit.')
    if not raw:
        raise ValueError('OpenStreetMap returned an empty vector tile.')
    with _lock:
        _cache[key] = (time.monotonic() + CACHE_SECONDS, raw)
        _cache.move_to_end(key)
        while len(_cache) > CACHE_LIMIT:
            _cache.popitem(last=False)
    return raw


def setup_building_tiles(app):
    from flask import Response, jsonify
    @app.get('/api/osm/tiles/<int:z>/<int:x>/<int:y>.pbf')
    def osm_vector_tile(z, x, y):
        try:
            data = load_tile(z, x, y)
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        except urllib.error.HTTPError as exc:
            return jsonify(error=f'OSM vector tile provider HTTP {exc.code}.'), 502
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            return jsonify(error='OSM vector tile provider unavailable.'), 503
        response = Response(data, mimetype='application/vnd.mapbox-vector-tile')
        response.headers['X-PlanetLab-OSM-Tile'] = 'OpenFreeMap'
        response.headers['Cache-Control'] = 'public, max-age=600'
        return response

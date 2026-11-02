"""Live public OSM data never enters these tests: deterministic proxy safety checks."""
import gzip
import io
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from backend import building_tiles as tiles


class FakeResponse:
    def __init__(self, data):
        self.input = io.BytesIO(data)
    def __enter__(self):
        return self
    def __exit__(self, *_):
        self.input.close()
    def read(self, n):
        return self.input.read(n)


class BuildingTileProxyTests(unittest.TestCase):
    def setUp(self):
        with tiles._lock:
            tiles._cache.clear()

    def test_fetch_caches_and_binds_upstream(self):
        calls=[]
        def fake(req, timeout):
            calls.append((req.full_url, timeout))
            return FakeResponse(b'\x1a\x05hello')
        one=tiles.load_tile(14, 8192, 5460, opener=fake)
        two=tiles.load_tile(14, 8192, 5460, opener=fake)
        self.assertEqual(one, two)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], 'https://tiles.openfreemap.org/planet/latest/14/8192/5460.pbf')
        self.assertLessEqual(calls[0][1], 10)

    def test_gzip_tile_decoding(self):
        original=b'\x1a\x05hello'
        self.assertEqual(tiles.load_tile(14, 8191, 5450, opener=lambda *a, **k: FakeResponse(gzip.compress(original))),original)

    def test_coordinates_and_oversized_response_fail_closed(self):
        for z,x,y in ((14,-1,2),(14,16384,2),(20,4,5),(14,4,16384)):
            with self.assertRaises(ValueError):
                tiles.load_tile(z,x,y,opener=lambda *a, **k: FakeResponse(b'valid'))
        with self.assertRaises(ValueError):
            tiles.load_tile(14,10,10,opener=lambda *a, **k: FakeResponse(b'a'*(tiles.MAX_TILE_BYTES+1)))

    def test_proxy_route_http_failures_are_sanitized(self):
        try:
            from backend.app import create_app
        except ImportError:
            self.skipTest('Backend dependencies not installed')
        import tempfile
        with tempfile.TemporaryDirectory() as temp:
            app=create_app({'TESTING':True,'DATA_DIR':temp,'SECRET_KEY':'test-only'})
            client=app.test_client()
            path='/api/osm/tiles/14/8191/5450.pbf'
            with patch.object(tiles,'load_tile',return_value=b'\x1a\x05hello'):
                res=client.get(path)
                self.assertEqual(res.status_code,200)
                self.assertEqual(res.data,b'\x1a\x05hello')
            with patch.object(tiles,'load_tile',side_effect=URLError('secret internal reason')):
                res=client.get(path)
                self.assertEqual(res.status_code,503)
                self.assertNotIn('secret internal reason',res.get_data(as_text=True))
            app.extensions['planet_db_session'].kw['bind'].dispose()

if __name__=='__main__':
    unittest.main()

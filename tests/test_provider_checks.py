"""Read-only provider tests never send a generation request."""
import importlib.util
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch
import json
import sys
import types

ROOT = Path(__file__).resolve().parents[1]
flask = types.ModuleType('flask')
flask.request = None
flask.abort = lambda _: None
flask.jsonify = lambda **kw: kw
spec = importlib.util.spec_from_file_location('planet_provider_checks_unit', ROOT/'backend/provider_checks.py')
with patch.dict(sys.modules, {'flask': flask}):
    checks = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(checks)

class ReadOnlyChecks(TestCase):
    def test_endpoints_are_readonly_and_allowlisted(self):
        for url in checks.CHECK_URLS.values():
            self.assertTrue(url.startswith('https://'))
        self.assertIn('/v3/account/balance',checks.CHECK_URLS['tripo'])
        self.assertIn('/v1/models',checks.CHECK_URLS['xai'])

    def test_model_list_response(self):
        class Resp:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,limit):return json.dumps({'data':[{'id':'grok-imagine-image-2.0'}]}).encode()
        with patch.object(checks.urllib.request,'urlopen',return_value=Resp()) as mock:
            result=checks.check_key('xai','key_for_testing_123456')
        self.assertTrue(result['image_model_visible'])
        self.assertEqual(mock.call_args[0][0].method,'GET')
        self.assertNotIn('balance',result)

    def test_tripo_balance(self):
        class Resp:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,limit):return b'{"code":0,"data":{"balance":1234,"frozen":12}}'
        with patch.object(checks.urllib.request,'urlopen',return_value=Resp()):
            result=checks.check_key('tripo','key_for_testing_123456')
        self.assertEqual(result['balance'],1234)
        self.assertEqual(result['frozen'],12)

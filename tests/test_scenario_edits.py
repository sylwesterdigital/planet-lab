"""Stdlib-only tests of real provider payloads and image-edit response safety."""
import base64
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
fake_flask = types.ModuleType('flask')
fake_flask.abort = lambda x: x
fake_flask.jsonify = lambda **x: x
fake_flask.request = None
spec = importlib.util.spec_from_file_location('_planetlab_scenario_edits_unit', ROOT/'backend'/'scenario_edits.py')
with patch.dict(sys.modules, {'flask': fake_flask}):
    edits = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(edits)

VALID_PNG = b'\x89PNG\r\n\x1a\n' + b'\0'*100
SOURCE = 'data:image/png;base64,' + base64.b64encode(VALID_PNG).decode()

class ScenarioEditTest(unittest.TestCase):
    def test_provider_routing_and_models(self):
        self.assertEqual(edits.PROVIDERS['openai'][1], 'gpt-image-2')
        self.assertEqual(edits.PROVIDERS['xai'][1], 'grok-imagine-image-2.0')
        self.assertEqual(edits.PROVIDERS['meta'][1], 'muse-image-1.0')
        for provider in edits.PROVIDERS:
            payload=edits.provider_payload(provider,'Remove buildings; keep trees.', SOURCE)
            self.assertIn('Remove buildings', payload['prompt'])
            self.assertIn('top-down',payload['prompt'])
            if provider=='xai':self.assertEqual(payload['image']['url'],SOURCE)
            else:self.assertEqual(payload['images'][0]['image_url'],SOURCE)
    def test_xai_uses_supported_ratio_not_unchecked_pixel_dimensions(self):
        supported = edits.XAI_RATIOS
        self.assertIn(edits.xai_aspect(2048, 1365), supported)
        self.assertEqual(edits.xai_aspect(2048, 1365), '3:2')
        payload = edits.provider_payload('xai', 'Restore', SOURCE, 2048, 2010, 1323, 'perspective')
        self.assertEqual(payload['aspect_ratio'], '3:2')
        self.assertNotEqual(payload['aspect_ratio'], '2010:1323')
        self.assertIn('perspective view', payload['prompt'])

    def test_provider_error_is_structured_and_never_leaks_source(self):
        data = b'{"error":{"type":"invalid_request_error","param":"aspect_ratio","message":"secret-user-key aspect_ratio must be supported"}}'
        detail = edits.safe_provider_error(data)
        self.assertEqual(detail['param'], 'aspect_ratio')
        self.assertNotIn('secret-user-key', str(detail))

    def test_resolution_payloads_use_provider_specific_options(self):
        self.assertEqual(edits.provider_payload('xai', 'Edit imagery', SOURCE, 2048)['resolution'], '2k')
        self.assertEqual(edits.provider_payload('xai', 'Edit imagery', SOURCE, 1024)['resolution'], '1k')
        self.assertEqual(edits.provider_payload('openai', 'Edit imagery', SOURCE, 2048)['size'], '2048x2048')
        self.assertNotIn('size', edits.provider_payload('meta', 'Edit imagery', SOURCE, 2048))
    def test_validate_source_and_output(self):
        self.assertEqual(edits.decode_data_image(SOURCE)[1],'png')
        response={'data':[{'b64_json':base64.b64encode(VALID_PNG).decode()}]}
        self.assertEqual(edits.extract_provider_image(response),SOURCE)
        for bad in ('data:image/svg+xml;base64,AAAA','data:image/png;base64,AAAA',
                    'https://google.com/pic.png'):
            with self.assertRaises(edits.ImageEditError):edits.decode_data_image(bad)
        with self.assertRaisesRegex(edits.ImageEditError,'temporary URL'):
            edits.extract_provider_image({'data':[{'url':'http://127.0.0.1/'}]})
        with self.assertRaises(edits.ImageEditError):edits.extract_provider_image({'data':[]})
    def test_payload_never_sends_api_key(self):
        for provider in edits.PROVIDERS:
            payload=edits.provider_payload(provider,'Keep trees.',SOURCE)
            self.assertNotIn('Authorization',json.dumps(payload))
    def test_route_enforces_user_login_and_csrf(self):
        source=(ROOT/'backend'/'scenario_edits.py').read_text()
        self.assertIn('require_csrf()',source)
        self.assertIn('if not actor(db)',source)
        self.assertIn("@app.post('/api/ai/scenario-edit')",source)
        self.assertIn('urllib.request.urlopen',source)

if __name__=='__main__':unittest.main()

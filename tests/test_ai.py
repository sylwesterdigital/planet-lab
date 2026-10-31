"""Provider tests are fully offline. No paid API request is made."""
import json
import os
import tempfile
import unittest
from unittest.mock import patch

from backend.integrations import update, load, public_settings, IntegrationError, parse_building
try:
    from backend.app import create_app
except ImportError:
    create_app=None

class ProviderRegistryTest(unittest.TestCase):
    def test_registry_defaults_secret_mask_and_host_guard(self):
        with tempfile.TemporaryDirectory() as temp:
            self.assertFalse(public_settings(temp)['meta']['configured'])
            with self.assertRaises(IntegrationError):
                update(temp,'meta',{'base_url':'http://127.0.0.1:8000'})
            result=update(temp,'meta',{'api_key':'very-long-private-key-123456','enabled':True})
            self.assertTrue(result['configured'])
            self.assertNotIn('api_key', result)
            self.assertEqual(load(temp)['meta']['api_key'],'very-long-private-key-123456')
            self.assertEqual(os.stat(os.path.join(temp,'private','integrations.json')).st_mode & 0o777,0o600)

    def test_parse_ai_output_is_bounded(self):
        b=parse_building('```json\n{"name":"Home","floors":900,"width":999,"roof":"gable"}\n```')
        self.assertEqual(b['floors'],20)
        self.assertEqual(b['width'],30)
        self.assertEqual(b['roof'],'gable')
        self.assertFalse(b['engineeringVerified'])
        with self.assertRaises(IntegrationError):parse_building('definitely not json')

@unittest.skipIf(create_app is None,'Backend dependencies not installed')
class ProviderAPITest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ,{'PLANETLAB_ADMIN_HANDLE':'admin1','PLANETLAB_ADMIN_USER_ID':'1'})
        self.env.start()
        self.app=create_app({'TESTING':True,'SECRET_KEY':'mock-only','DATA_DIR':self.temp.name})
        self.client=self.app.test_client()
        self.csrf=self.client.get('/api/session').json['csrf']
    def tearDown(self):
        self.app.extensions['planet_db_session'].kw['bind'].dispose()
        self.env.stop()
        self.temp.cleanup()
    def send(self,path,body,method='POST'):
        return self.client.open(path,method=method,json=body,headers={'X-CSRF-Token':self.csrf})
    def test_admin_only_api_key_and_generated_spec(self):
        self.assertEqual(self.client.get('/api/integrations').status_code,403)
        reg=self.send('/api/register',{'handle':'admin1','password':'secure-testing-password'})
        self.csrf=reg.json['csrf']
        updated=self.send('/api/integrations/meta',{'enabled':True,'api_key':'very-secret-private-test-key'},'PUT')
        self.assertEqual(updated.status_code,200,updated.json)
        self.assertNotIn('very-secret',json.dumps(updated.json))
        self.assertNotIn('very-secret',json.dumps(self.client.get('/api/integrations').json))
        self.assertEqual(self.send('/api/integrations/meta',{'base_url':'http://127.0.0.1'},'PUT').status_code,400)
        with patch('backend.ai_routes.provider_request',return_value={
            'choices':[{'message':{'content':'{"floors":2,"width":9,"roof":"flat"}'}}]}):
            response=self.send('/api/ai/building',{'brief':'Modern house next to the lake'})
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(response.json['building']['width'],9)
        self.assertFalse(response.json['building']['engineeringVerified'])
        logout=self.send('/api/logout',{})
        self.csrf=logout.json['csrf']
        self.assertEqual(self.client.get('/api/integrations').status_code,403)

if __name__=='__main__':unittest.main()

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
    def test_signed_in_nonadmin_bring_your_own_key_is_never_saved(self):
        reg=self.send('/api/register',{'handle':'ordinary1','password':'secure-testing-password'})
        self.assertEqual(reg.status_code,201)
        self.csrf=reg.json['csrf']
        self.assertEqual(self.client.get('/api/integrations').status_code,403)
        with patch('backend.ai_routes.provider_request',return_value={
            'choices':[{'message':{'content':'{"floors":3,"width":11,"roof":"gable"}'}}]}) as mock:
            response=self.client.post('/api/ai/building',json={
                'brief':'Small alpine workshop with upper rooms','model':'muse-spark-1.3'},
                headers={'X-CSRF-Token':self.csrf,'X-PlanetLab-Meta-Key':'user-owned-private-test-key'})
            self.assertEqual(response.status_code,200,response.json)
            self.assertEqual(response.json['building']['width'],11)
            self.assertEqual(mock.call_args.args[0]['api_key'],'user-owned-private-test-key')
        self.assertFalse(os.path.exists(os.path.join(self.temp.name,'private','integrations.json')))
        missing=self.send('/api/ai/building',{'brief':'Small alpine workshop'})
        self.assertEqual(missing.status_code,400,missing.json)
        self.assertIn('AI Setup', missing.json['error'])
        missing_connection = self.send('/api/ai/connection-test',
                                       {'provider':'meta','model':'muse-spark-1.3'})
        self.assertEqual(missing_connection.status_code,400,missing_connection.json)
        self.assertIn('AI Setup', missing_connection.json['error'])
        with patch('backend.ai_routes.provider_request',return_value={
            'choices':[{'message':{'content':'ready'}}]}):
            ping=self.client.post('/api/ai/connection-test',json={'provider':'meta','model':'muse-spark-1.3'},
                headers={'X-CSRF-Token':self.csrf,'X-PlanetLab-Meta-Key':'user-owned-private-test-key'})
        self.assertEqual(ping.status_code,200,ping.json)
        self.assertTrue(ping.json['ok'])
        self.assertNotIn('user-owned-private-test-key',json.dumps(ping.json))

    def test_malformed_byok_key_and_model_are_client_errors_without_provider_calls(self):
        reg=self.send('/api/register',{'handle':'maker2','password':'secure-testing-password'})
        self.assertEqual(reg.status_code,201)
        self.csrf=reg.json['csrf']
        with patch('backend.ai_routes.provider_request') as external:
            badkey=self.client.post('/api/ai/building',json={
                'brief':'An alpine workshop'},headers={
                'X-CSRF-Token':self.csrf,'X-PlanetLab-Meta-Key':'short'})
            self.assertEqual(badkey.status_code,400,badkey.json)
            self.assertIn('Invalid provider key', badkey.json['error'])
            badmodel=self.client.post('/api/ai/building',json={
                'brief':'An alpine workshop','model':'invalid-model'},headers={
                'X-CSRF-Token':self.csrf,'X-PlanetLab-Meta-Key':'valid-private-test-key'})
            self.assertEqual(badmodel.status_code,400,badmodel.json)
            external.assert_not_called()

    def test_upstream_provider_failure_still_returns_502(self):
        reg=self.send('/api/register',{'handle':'maker3','password':'secure-testing-password'})
        self.assertEqual(reg.status_code,201)
        self.csrf=reg.json['csrf']
        with patch('backend.ai_routes.provider_request',side_effect=IntegrationError('Provider HTTP 503')):
            failed=self.client.post('/api/ai/building',json={
                'brief':'An alpine workshop','model':'muse-spark-1.3'},headers={
                'X-CSRF-Token':self.csrf,'X-PlanetLab-Meta-Key':'valid-private-test-key'})
            self.assertEqual(failed.status_code,502,failed.json)
            self.assertEqual(failed.json['error'],'Provider HTTP 503')

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

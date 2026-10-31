"""Run on Ubuntu after dependencies install: python -m unittest discover -s tests."""
import io
import tempfile
import unittest
from pathlib import Path

try:
    from backend.app import create_app
except ImportError:
    create_app = None


@unittest.skipIf(create_app is None, 'Install backend/requirements.txt to run integration tests')
class PlanetBackendTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app({'TESTING': True, 'DATA_DIR': self.temp.name, 'SECRET_KEY': 'integration-test-only'})
        self.client = self.app.test_client()
        self.csrf = self.client.get('/api/session').json['csrf']

    def tearDown(self):
        self.app.extensions['planet_db_session'].kw['bind'].dispose()
        self.temp.cleanup()

    def post(self, path, data):
        return self.client.post(path, json=data, headers={'X-CSRF-Token': self.csrf})

    def test_health_auth_world_revisions_and_media(self):
        self.assertEqual(self.client.get('/api/health').json['status'], 'ok')
        self.assertEqual(self.post('/api/worlds', {'blueprint': {'config': {}}}).status_code, 401)
        reg = self.post('/api/register', {'handle': 'maker1', 'password': 'strong-test-password'})
        self.assertEqual(reg.status_code, 201, reg.json)
        self.csrf = reg.json['csrf']
        plan = {'config': {'seed': 'ALPHA', 'level': 'basic'}, 'tasks': []}
        created = self.post('/api/worlds', {'title': 'Test city', 'blueprint': plan})
        self.assertEqual(created.status_code, 201, created.json)
        world_id = created.json['id']
        self.assertEqual(self.client.get(f'/api/worlds/{world_id}').json['blueprint'], plan)
        self.assertEqual(len(self.client.get('/api/worlds').json['worlds']), 1)
        conflict = self.client.put(f'/api/worlds/{world_id}', json={'blueprint': plan, 'revision': 8}, headers={'X-CSRF-Token': self.csrf})
        self.assertEqual(conflict.status_code, 409)
        update = self.client.put(f'/api/worlds/{world_id}', json={'blueprint': plan, 'revision': 1, 'is_public': True}, headers={'X-CSRF-Token': self.csrf})
        self.assertEqual(update.json['revision'], 2)
        glb = b'glTF' + (2).to_bytes(4,'little') + (12).to_bytes(4,'little')
        upload = self.client.post(f'/api/worlds/{world_id}/media', data={'file': (io.BytesIO(glb),'simple.glb')}, headers={'X-CSRF-Token': self.csrf}, content_type='multipart/form-data')
        self.assertEqual(upload.status_code, 201, upload.json)
        self.assertTrue(self.client.get('/api/media/'+upload.json['id']).headers['Content-Disposition'].startswith('attachment;'))
        self.assertEqual(self.client.get('/api/worlds').json['worlds'][0]['revision'], 2)

    def test_cookies_permissions_and_csrf(self):
        self.assertEqual(self.client.post('/api/register', json={'handle': 'nope', 'password': 'long-enough-test-password'}).status_code, 403)
        self.post('/api/register', {'handle': 'owner', 'password': 'a-long-valid-password'})
        self.csrf = self.client.get('/api/session').json['csrf']
        created = self.post('/api/worlds', {'title': 'Private', 'blueprint': {'config': {}}})
        world_id = created.json['id']
        second = self.app.test_client()
        self.assertEqual(second.get(f'/api/worlds/{world_id}').status_code, 404)
        self.assertEqual(second.get('/api/worlds').json['worlds'], [])


if __name__ == '__main__':
    unittest.main()

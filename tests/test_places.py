"""Persistent fictional-planet snapshots: owner-only stars, CSRF, revision safety."""
import tempfile
import unittest
try:
    from backend.app import create_app
except ImportError:
    create_app = None

@unittest.skipIf(create_app is None, 'Install backend/requirements.txt to run integration tests')
class PlaceSnapshotsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = create_app({'TESTING':True, 'DATA_DIR':self.tmp.name, 'SECRET_KEY':'test-places-key'})
        self.c = self.app.test_client()
        token=self.c.get('/api/session').json['csrf']
        r=self.c.post('/api/register',json={'handle':'placeowner','password':'some-long-test-password'},headers={'X-CSRF-Token':token})
        self.assertEqual(r.status_code,201,r.json)
        self.csrf=r.json['csrf']

    def tearDown(self):
        self.app.extensions['planet_db_session'].kw['bind'].dispose()
        self.tmp.cleanup()

    def test_snapshot_pins_private_and_favourites(self):
        self.assertEqual(self.c.get('/api/releases').json['releases'],[])
        plan={'config':{'seed':'PLANET-12','anchor':{'lat':13.2,'lon':-44.8},'site':[4.1,5.2]},
              'place':{'starred':False,'codename':'fire-station'},'studioBuildings':[], 'tasks':[]}
        created=self.c.post('/api/worlds',json={'title':'Harbour site','blueprint':plan},headers={'X-CSRF-Token':self.csrf})
        self.assertEqual(created.status_code,201,created.json)
        wid=created.json['id']
        listing=self.c.get('/api/worlds').json['worlds'][0]
        self.assertEqual(listing['anchor'],{'lat':13.2,'lon':-44.8})
        self.assertEqual(listing['seed'],'PLANET-12')
        self.assertEqual(listing['codename'],'fire-station')
        self.assertFalse(listing['starred'])
        anonymous=self.app.test_client()
        self.assertEqual(anonymous.get('/api/worlds').json['worlds'],[])
        denied=self.c.patch(f'/api/worlds/{wid}/star',json={'starred':True,'revision':1})
        self.assertEqual(denied.status_code,403)
        starred=self.c.patch(f'/api/worlds/{wid}/star',json={'starred':True,'revision':1},headers={'X-CSRF-Token':self.csrf})
        self.assertEqual(starred.status_code,200,starred.json)
        self.assertEqual(starred.json,{'id':wid,'revision':2,'starred':True})
        self.assertTrue(self.c.get('/api/worlds').json['worlds'][0]['starred'])
        self.assertTrue(self.c.get(f'/api/worlds/{wid}').json['blueprint']['place']['starred'])
        conflict=self.c.patch(f'/api/worlds/{wid}/star',json={'starred':False,'revision':1},headers={'X-CSRF-Token':self.csrf})
        self.assertEqual(conflict.status_code,409)
        self.assertEqual(anonymous.patch(f'/api/worlds/{wid}/star',json={'starred':False,'revision':2}).status_code,403)

if __name__=='__main__':unittest.main()

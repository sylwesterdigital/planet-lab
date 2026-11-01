"""View continuity and observed OSM building geometry release guards."""
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class EarthViewsUiTest(unittest.TestCase):
 def test_view_controls_and_release(self):
  page=(ROOT/'index.html').read_text()
  for name in ('viewBookmarkName','viewBookmarkSave','viewBookmarkList','viewRecentList','showBuildingOutlines'):
   self.assertIn('id="'+name+'"',page)
  self.assertIn('src="./earth-history.mjs?v=0.4.18"',page)
  self.assertIn('earth-history.mjs', (ROOT/'backend/app.py').read_text())
 def test_restore_has_real_dem_and_camera(self):
  source=(ROOT/'earth-history.mjs').read_text()
  self.assertIn('await sim.selectEarthSite(a)',source)
  self.assertIn('sim.world.camera.position.fromArray',source)
  self.assertIn('sim.world.controls.target.fromArray',source)
  self.assertIn("window.addEventListener('planetlab:auth-changed'",source)
  self.assertIn("localStorage.setItem(storageKey(scope)",source)
  self.assertNotIn('imageryKey',source)
 def test_osm_height_honesty(self):
  source=(ROOT/'app.mjs').read_text()
  self.assertIn("'estimated-from-storeys'",source)
  self.assertIn('THREE.ShapeUtils.triangulateShape',source)
  self.assertIn('showViewBookmarks',source)
 def test_watcher_checks_new_tests(self):
  source=(ROOT/'scripts/release_watcher.py').read_text()
  self.assertIn("'test-earth-views.mjs'",source)
  self.assertIn("'earth-history.mjs'",source)
if __name__=='__main__':unittest.main()

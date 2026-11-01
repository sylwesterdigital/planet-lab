"""Zero-dependency smoke tests for v0.4.12 UI improvements."""
import re
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class PlaceUiTest(unittest.TestCase):
 def test_version_and_updates(self):
  page=(ROOT/'index.html').read_text()
  self.assertIn('<strong>PlanetLab</strong>',page)
  self.assertIn('v0.4.12',page)
  self.assertIn('https://github.com/sylwesterdigital/planet-lab',page)
  self.assertIn('updates.json', (ROOT/'update-feed.mjs').read_text())
 def test_geopins_and_snapshots(self):
  page=(ROOT/'index.html').read_text()
  for id in ('snapshotList','snapshotSave','snapshotFilter','snapshotType','snapshotName','buildingCodeName','buildingCodeType'):
   self.assertIn('id="'+id+'"',page)
  js=(ROOT/'placebook.mjs').read_text()
  self.assertIn("/api/worlds",js)
  self.assertIn("/star",js)
  self.assertIn("renderPlacePins",js)
 def test_webxr_only_if_supported(self):
  script=(ROOT/'app.mjs').read_text()
  self.assertIn("navigator.xr.isSessionSupported('immersive-vr')",script)
  self.assertIn('this.setupXR()',script)
  self.assertNotIn("appendChild(xrButton)",script)
  self.assertIn('target.appendChild(button)',script)
  self.assertIn('xr-stage-entry', (ROOT/'index.html').read_text())
 def test_console_min_and_readability(self):
  js=(ROOT/'api-console.mjs').read_text()
  self.assertIn('apiConsoleMin',js)
  self.assertIn('Math.max(6,fontSize-1)',js)
  self.assertIn('Math.min(26,fontSize+1)',js)
  self.assertIn('setMinimised',js)
 def test_privacy_and_catalog(self):
  js=(ROOT/'system-catalog.mjs').read_text()
  self.assertIn('Hospital',js)
  self.assertIn('Fire station',js)
  self.assertIn('Power plant',js)
  self.assertIn('Heliport',js)
  self.assertIn('Unitless',js.replace('unitless','Unitless'))
  self.assertNotIn('localStorage', (ROOT/'placebook.mjs').read_text())
if __name__=='__main__':unittest.main()

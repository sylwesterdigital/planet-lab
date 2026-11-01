"""Regression checks for physical scale and visible planning limits in v0.4.12."""
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

class GeographyUiTests(unittest.TestCase):
 def test_same_geography_in_globe_and_local_view(self):
  planner=(ROOT/'planner.mjs').read_text()
  app=(ROOT/'app.mjs').read_text()
  self.assertIn('planetSurfaceHeight(planetPatchPoint(config.anchor,x,z),config.seed)',planner)
  self.assertIn('planetSurfaceHeight([x,y,z],seed)',app)
  self.assertIn('worldToLocal(hit.point.clone())',app)
  self.assertIn('10 / 6371000',planner)
  self.assertIn('clearGroup(this.regionGroup)',app)
 def test_snapshot_pin_opens_saved_plan(self):
  js=(ROOT/'placebook.mjs').read_text()
  self.assertIn('act(()=>openSnapshot(w))',js)
  self.assertIn('window.planetLabWorlds.loadId(w.id)',js)
  self.assertIn("window.planetLabWorkflow?.show('city')",js)
  self.assertIn("'planet.city.plan.v2'",(ROOT/'collab.mjs').read_text())
 def test_constraints_visible_without_claims_of_certification(self):
  page=(ROOT/'index.html').read_text()
  for text in ('id="feasibilityList"','id="feasibilityState"','No verified','1.56 km','Illustrative cost'):
   self.assertIn(text,page)
  planner=(ROOT/'planner.mjs').read_text()
  for text in ('assessTerrain(', 'roadAccessParcels:', 'roadConnected:', 'stormwater strategy requires catchment study', 'utilities operator', 'airport'):
   self.assertIn(text,planner)
 def test_scale_and_lifecycles(self):
  app=(ROOT/'app.mjs').read_text();studio=(ROOT/'studio.mjs').read_text()
  self.assertIn('g.scale.setScalar(.1)',app)
  self.assertIn('buildingGroup.scale.setScalar(.1)',studio)
  self.assertIn('network is incomplete', (ROOT/'planner.mjs').read_text())

if __name__=='__main__':unittest.main()

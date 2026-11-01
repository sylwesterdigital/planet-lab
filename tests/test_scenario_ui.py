import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class ScenarioUITest(unittest.TestCase):
 def test_panel_and_modules(self):
  html=(ROOT/'index.html').read_text()
  for name in ('scenarioPick','scenarioPrompt','scenarioProvider','scenarioKey','scenarioCrop','scenarioGenerate','scenarioList','scenarioMode','scenarioOpacity','scenarioSplit','scenarioBuild'):
   self.assertIn('id="'+name+'"',html)
  self.assertIn('earth-scenarios.mjs?v=0.4.20',html)
  self.assertIn("'earth-scenarios.mjs'",(ROOT/'backend/app.py').read_text())
 def test_geographic_edit_and_persistence(self):
  js=(ROOT/'earth-scenarios.mjs').read_text()
  self.assertIn("indexedDB.open('planetlab-scenarios-v1'",js)
  self.assertIn("fetch('/api/ai/scenario-edit'",js)
  self.assertIn('rasterRect(layer.bounds',js)
  self.assertIn('createImageBitmap(layer.blob)',js)
  self.assertNotIn('localStorage.setItem',js)
  self.assertIn("window.planetLabWorkflow?.show('build')",js)
 def test_world_terrain_capture(self):
  js=(ROOT/'app.mjs').read_text()
  self.assertIn('baseImageryCanvas=canvas',js)
  self.assertIn("new Event('planetlab:imagery-ready')",js)
  self.assertIn('drawScenarioBounds(bounds)',js)
  self.assertIn("'planetlab:scenario-point'",js)
if __name__=='__main__':unittest.main()

import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class ScenarioUITest(unittest.TestCase):
 def test_panel_and_modules(self):
  html=(ROOT/'index.html').read_text()
  for name in ('scenarioPick','scenarioPrompt','scenarioProvider','scenarioKey','scenarioCrop','scenarioGenerate','scenarioList','scenarioMode','scenarioOpacity','scenarioSplit','scenarioBuild'):
   self.assertIn('id="'+name+'"',html)
  version=__import__('re').search(r"VERSION = '([^']+)'", (ROOT/'backend/app.py').read_text()).group(1)
  self.assertIn('earth-scenarios.mjs?v='+version,html)
  self.assertIn("'earth-scenarios.mjs'",(ROOT/'backend/app.py').read_text())
 def test_geographic_edit_and_persistence(self):
  js=(ROOT/'earth-scenarios.mjs').read_text()
  self.assertIn("indexedDB.open('planetlab-scenarios-v1'",js)
  self.assertIn("fetch('/api/ai/scenario-edit'",js)
  self.assertIn('world.addScenarioLayer(layer.bounds',js)
  self.assertIn('size:selectedResolution()',js)
  self.assertIn('setScenarioJob(true,requestBounds)',js)
  self.assertIn('setScenarioJob(false,requestBounds)',js)
  self.assertIn('createImageBitmap(layer.blob)',js)
  self.assertNotIn('localStorage.setItem',js)
  self.assertIn("window.planetLabWorkflow?.show('build')",js)
 def test_world_terrain_capture(self):
  js=(ROOT/'app.mjs').read_text()
  self.assertIn('baseImageryCanvas=canvas',js)
  self.assertIn("new Event('planetlab:imagery-ready')",js)
  self.assertIn('drawScenarioBounds(bounds)',js)
  self.assertIn('addScenarioLayer(bounds,imageBitmap',js)
  self.assertIn('clearScenarioLayers()',js)
  self.assertIn("'planetlab:scenario-point'",js)
  self.assertIn('drawScenarioFirstCorner(point)',js)
  self.assertIn('linewidth:width',js)
  self.assertIn('[[12,0x160307,100],[7,0xff2438,101]]',js)
  self.assertIn('depthTest:false',js)
  editor=(ROOT/'earth-scenarios.mjs').read_text()
  self.assertIn('world?.drawScenarioFirstCorner(point)',editor)
  self.assertIn("'scenario-picking'",editor)
if __name__=='__main__':unittest.main()

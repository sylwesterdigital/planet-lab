"""Fast checks for actionable first-run PlanetLab workspaces."""
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class WorkflowUITests(unittest.TestCase):
    def test_start_actions_and_navigation(self):
        page=(ROOT/'index.html').read_text()
        for identifier in ('workflowEntry','startCity','startHouse','startExplore','flowWorld','flowCity','flowBuild','flowPlaces','flowInsights','flowSave'):
            self.assertIn('id="'+identifier+'"',page)
    def test_no_auto_city_on_load(self):
        app=(ROOT/'app.mjs').read_text()
        self.assertIn('this.generateWorld();this.loop=',app)
        self.assertNotIn('this.generateWorld();this.createPlan();',app)
    def test_actions_use_existing_builders(self):
        script=(ROOT/'workflow.mjs').read_text()
        self.assertIn("$('plan').click()",script)
        self.assertIn("$('manualBuilding').click()",script)
        self.assertIn("$('planetMode').click()",script)
        self.assertIn("$('snapshotName')?.focus()",script)
    def test_no_fake_economy(self):
        self.assertIn('fictional geography', (ROOT/'README.md').read_text())
        self.assertIn('no real-world planning', (ROOT/'index.html').read_text())
if __name__=='__main__':unittest.main()

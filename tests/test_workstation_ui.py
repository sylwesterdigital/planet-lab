"""Regression checks for the workstation usability corrections in 0.4.9."""
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class WorkstationUITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page=(ROOT/'index.html').read_text()
        cls.world=(ROOT/'app.mjs').read_text()
        cls.flow=(ROOT/'workflow.mjs').read_text()
    def test_tools_are_persistent_and_viewport_does_not_scroll(self):
        self.assertIn('.workspace[data-flow]>.left',self.page)
        self.assertIn('.workspace[data-flow]>.right',self.page)
        self.assertIn('height:100dvh',self.page)
        self.assertIn('overflow:hidden;grid-template-rows:56px minmax(0,1fr)',self.page)
        self.assertNotIn('.workspace[data-flow="build"]>.left{display:none}',self.page)
        self.assertIn('<div class="bottom">',self.page)
    def test_initial_globe_after_threejs_initializes(self):
        self.assertIn('planetlab:app-ready',self.world)
        self.assertIn('planetlab:app-ready',self.flow)
        self.assertIn("if(mode==='world')$('planetMode').click()",self.flow)
        self.assertIn('id="workflowEntry" hidden',self.page)
    def test_site_massing_and_robots_controls(self):
        for control in ('viewMassing','viewPlan','viewAgents','showVegetation'):
            self.assertIn('id="'+control+'"',self.page)
        self.assertIn('this.showAgents=false',self.world)
        self.assertIn('this.showVegetation=false',self.world)
        self.assertIn('setDisplayMode(mode)',self.world)
        self.assertIn('this.world.setAgentVisibility',self.world)
        self.assertNotIn("box(this.group,0,1.46,0,.42,.35,.37,'#e4edf1')",self.world)
    def test_access_to_existing_actions(self):
        for control in ('plan','planetMode','regionMode','manualBuilding','snapshotName','aiBuilding'):
            self.assertIn('id="'+control+'"',self.page)
if __name__=='__main__':unittest.main()

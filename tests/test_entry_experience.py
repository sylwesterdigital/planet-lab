"""Interaction-level start-page checks run without Flask or a browser network."""
import subprocess
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

class EntryExperienceTests(unittest.TestCase):
    def test_welcome_location_and_communication(self):
        page=(ROOT/'index.html').read_text()
        left=page.index('<aside class="sidebar left">')
        greeting=page.index('id="welcomeUser"')
        canvas=page.index('id="earthMap"')
        self.assertLess(left,greeting)
        self.assertLess(greeting,canvas)
        self.assertIn('Select a location',page)
        self.assertIn('Real Earth',page)
        self.assertIn('id="earthStatus"',page)
        self.assertIn('Keys are only requested when you choose an AI feature',page)
        self.assertNotIn('id="workflowEntry" hidden',page)
        self.assertIn('id="aiSetupBackdrop" hidden',page)
    def test_navigation_and_on_demand_ai_in_node(self):
        result=subprocess.run(['node','test-entry.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('PASS',result.stdout)

if __name__ == "__main__":
    unittest.main()

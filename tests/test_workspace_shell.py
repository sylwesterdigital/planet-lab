"""Static contract tests for the simplified shell and perspective viewer."""
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class WorkspaceShellTest(unittest.TestCase):
 def test_flat_workspaces_and_map_panel(self):
  page=(ROOT/'index.html').read_text()
  shell=(ROOT/'ui-shell.mjs').read_text()
  for id in ('tabExplore','tabCreate','tabProjects','toolDock','toolDockHandle','toolDockCollapse','toolDockToggle','topKeys'):
   self.assertIn(f'id="{id}"',page)
  for name in ('explore','create','projects'):
   self.assertIn(f"take('" ,shell)
   self.assertIn(f"{name}",shell)
  self.assertIn("for(const detail of dock.querySelectorAll('details'))",shell)
  self.assertIn('display:none!important',page)
 def test_central_keys_with_explicit_persistence(self):
  page=(ROOT/'index.html').read_text();keys=(ROOT/'provider-keys.mjs').read_text()
  for provider in ('meta','xai','openai'):
   self.assertIn(f'id="providerKey-{provider}"',page)
   self.assertIn("getProviderKey(provider)",(ROOT/'perspective-gallery.mjs').read_text())
  self.assertIn('Remember on this device',page)
  self.assertIn('if(remembering)',keys)
  self.assertIn('localStorage.removeItem(STORE)',keys)
 def test_gallery_click_and_visible_draw_mode(self):
  page=(ROOT/'index.html').read_text();gallery=(ROOT/'perspective-gallery.mjs').read_text()
  self.assertIn('id="drawingModeBanner"',page)
  self.assertIn('id="perspectiveGalleryViewer"',page)
  self.assertIn('button.onclick=()=>showGalleryImage(item.id)',gallery)
  self.assertIn('hidePreview();showGalleryImage(item.id)',gallery)
  self.assertIn('drag on the map',gallery.lower())
  self.assertIn('viewer().hidden=false',gallery)
if __name__=='__main__':unittest.main()

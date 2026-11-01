"""Regression guards for the hidden preview and WebGL screenshot capture."""
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class PerspectivePreviewTest(unittest.TestCase):
 def test_preview_is_truly_hidden_until_requested(self):
  html=(ROOT/'index.html').read_text()
  self.assertIn('#perspectivePreviewModal[hidden]',html)
  self.assertIn('{display:none!important}',html)
  self.assertIn('id="perspectivePreviewModal" hidden',html)
  self.assertIn('id="perspectiveReview"',html)
  self.assertIn('id="perspectivePreviewImage"',html)
 def test_capture_uses_fresh_webgl_frame_and_bounded_image(self):
  js=(ROOT/'perspective-gallery.mjs').read_text()
  self.assertIn('world.render();',js)
  self.assertIn("out.toDataURL('image/jpeg',quality)",js)
  self.assertIn('function hidePreview()',js)
  self.assertIn('previewModal().hidden=false',js)
  self.assertIn('perspectiveReview',js)
  self.assertIn("event.key!=='Enter'",js)
  self.assertIn("mode:'perspective'",js)
if __name__=='__main__':unittest.main()

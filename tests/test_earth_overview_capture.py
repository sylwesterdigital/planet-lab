"""Guard selection and image capture directly on the MapLibre 3D overview."""
import re
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

class EarthOverviewCaptureTest(unittest.TestCase):
    def test_overview_drawing_uses_visible_map_canvas(self):
        earth=(ROOT/'earth-map.mjs').read_text()
        gallery=(ROOT/'perspective-gallery.mjs').read_text()
        self.assertIn('preserveDrawingBuffer:true',earth)
        self.assertIn("overviewMode()?mapInstance()?.getCanvas?.():sceneCanvas()",gallery)
        self.assertIn("activeViewCanvas()",gallery)
        self.assertIn("if(world.mode==='region')world.render();",gallery)
        self.assertIn("return {type:'earth-overview'",gallery)
        self.assertNotIn("if(siteWorld()?.mode!=='region'){status('Open a local terrain",gallery)

    def test_click_keeps_overview_and_terrain_is_opt_in(self):
        app=(ROOT/'app.mjs').read_text()
        self.assertIn('anchor=>this.selectEarthMapPoint(anchor)',app)
        self.assertIn('selectEarthMapPoint(anchor){',app)
        method=app.split('selectEarthMapPoint(anchor){',1)[1].split(' async selectEarthSite(',1)[0]
        self.assertNotIn('this.selectEarthSite(',method)
        self.assertIn("$('regionMode').onclick=async()=>",app)
        self.assertIn("./earth-map.mjs?v=0.4.37",app)

    def test_selected_frame_is_preserved_for_generation(self):
        gallery=(ROOT/'perspective-gallery.mjs').read_text()
        self.assertIn('function selectedFrame(',gallery)
        self.assertIn('state.sceneFrame=frame',gallery)
        self.assertIn('frame.image;',gallery)
        self.assertIn("const frame=selectedFrame(state.rect);sourcePayload=frame.image",gallery)
        self.assertIn('state.sceneFrame?.view||null',gallery)
        self.assertIn("world.mode==='region'",gallery)

if __name__=='__main__':unittest.main()

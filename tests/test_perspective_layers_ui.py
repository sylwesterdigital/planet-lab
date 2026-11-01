"""Guard real layered editor / drawing workflow against reverting to a passive lightbox."""
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]

class CompositionEditorUiTest(unittest.TestCase):
    def test_editor_has_inline_selection_and_generation(self):
        html=(ROOT/'index.html').read_text()
        script=(ROOT/'perspective-gallery.mjs').read_text()
        for id in ('galleryViewerDrawSurface','galleryViewerSelection','galleryViewerPatchPreview',
                   'galleryViewerPrompt','galleryViewerProvider','galleryViewerGenerate',
                   'galleryViewerLayers','galleryViewerUndo','galleryViewerRedo'):
            self.assertIn(f'id="{id}"',html)
        self.assertIn('setPointerCapture',script)
        self.assertIn("captureCompositionCrop(currentItem(),state.composition.rect,resolution())",script)
        self.assertIn("$('galleryViewerGenerate').onclick=()=>generatePerspective('composition')",script)
        self.assertIn('updateCompositionPreview()',script)

    def test_each_layer_has_icon_actions_and_picture(self):
        script=(ROOT/'perspective-gallery.mjs').read_text()
        self.assertIn("thumb.className='viewer-layer-thumb'",script)
        self.assertIn('layerActionButton',script)
        for action in ('moveLayer(layer.id,+1)','moveLayer(layer.id,-1)','toggleLayer(layer.id)','deleteLayer(layer.id)'):
            self.assertIn(action,script)
        self.assertIn('item.undoStack',script)
        self.assertIn('item.redoStack',script)
        self.assertIn('item.assets',script)

if __name__=='__main__':unittest.main()

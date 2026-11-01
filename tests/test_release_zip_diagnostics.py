"""Exercise exact ZIP failure reporting, including the v0.4.28 regression."""
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path
from scripts import release_watcher as watcher


class ZipDiagnosticTests(unittest.TestCase):
    def test_missing_manifest_names_missing_file_not_generic_duplicates(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'PLANETLAB_RELEASE_v9.9.9.zip'
            with zipfile.ZipFile(file, 'w') as z:
                z.writestr('app/index.html', 'test')
            with self.assertRaisesRegex(watcher.ReleaseError, r'missing manifest\.json at archive root') as caught:
                watcher.verify(file, Path(tmp) / 'stage')
            self.assertNotIn('duplicat', str(caught.exception).lower())

    def test_duplicate_filename_names_affected_entry(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'PLANETLAB_RELEASE_v9.9.9.zip'
            with warnings.catch_warnings():
                warnings.simplefilter('ignore', UserWarning)
                with zipfile.ZipFile(file, 'w') as z:
                    z.writestr('manifest.json', '{}')
                    z.writestr('app/foo.mjs', 'abc')
                    z.writestr('app/foo.mjs', 'def')
            with self.assertRaisesRegex(watcher.ReleaseError, r'duplicated filename.*app/foo\.mjs'):
                watcher.verify(file, Path(tmp) / 'stage')

    def test_invalid_manifest_json_is_actionable(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'PLANETLAB_RELEASE_v9.9.9.zip'
            with zipfile.ZipFile(file, 'w') as z:
                z.writestr('manifest.json', '{oops')
            with self.assertRaisesRegex(watcher.ReleaseError, r'manifest\.json contains invalid JSON'):
                watcher.verify(file, Path(tmp) / 'stage')

    def test_building_renderer_method_remains_callable(self):
        source = Path(__file__).resolve().parents[1].joinpath('app.mjs').read_text()
        self.assertIn('showExistingBuildings(data){', source)
        self.assertIn('mappedBuildingsVisible', source)
        self.assertNotIn('this.showExistingBuildings=', source)


if __name__ == '__main__':
    unittest.main()

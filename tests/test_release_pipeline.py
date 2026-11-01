"""Prevent recurrence of local test import failures in staged ZIP releases."""
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class ReleasePipelineTests(unittest.TestCase):
    def test_watcher_uses_root_based_discovery_not_script_entrypoints(self):
        source = (ROOT / 'scripts/release_watcher.py').read_text()
        self.assertIn("['python3', '-m', 'unittest', 'discover', '-s', 'tests',", source)
        self.assertNotIn("['python3','tests/test_building_generation.py']", source)

    def test_building_generation_standalone_mode(self):
        result = subprocess.run([sys.executable, 'tests/test_building_generation.py'],
                                cwd=ROOT, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

if __name__ == '__main__':
    unittest.main()

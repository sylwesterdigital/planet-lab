"""Regression checks for mixed-release module caching and auth boot (stdlib only)."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ReleaseFrontendTest(unittest.TestCase):
    def test_versioned_module_entrypoints(self):
        html = (ROOT / 'index.html').read_text()
        for module in ('app', 'collab', 'studio'):
            self.assertIn(f'src="./{module}.mjs?v=0.4.6"', html)
        self.assertIn("from './planner.mjs?v=0.4.6'", (ROOT / 'app.mjs').read_text())

    def test_uncacheable_html_and_scripts(self):
        backend = (ROOT / 'backend/app.py').read_text()
        self.assertIn("path.endswith(('.html', '.mjs', '.js'))", backend)
        self.assertIn("'no-store, max-age=0' if uncacheable", backend)

    def test_old_registration_handlers_do_not_exist(self):
        collab = (ROOT / 'collab.mjs').read_text()
        self.assertNotRegex(collab, re.compile(r"el\(['\"](?:register|login|logout)['\"]\)"))
        self.assertIn('await bootAuth()', collab)
        self.assertIn('await sessionInfo();', collab)

    def test_session_only_ai_setup_is_available_to_signed_in_users(self):
        html = (ROOT / 'index.html').read_text()
        studio = (ROOT / 'studio.mjs').read_text()
        setup = (ROOT / 'ai-connections.mjs').read_text()
        self.assertIn('id="aiSetupBackdrop"', html)
        self.assertIn('id="aiMetaKey"', html)
        self.assertIn('id="aiTestKey"', html)
        self.assertIn('id="aiSetupTop"', html)
        self.assertIn("getAiHeaders(path)", studio)
        self.assertIn("'/api/ai/connection-test'", setup)
        self.assertNotIn('localStorage', setup.replace('localStorage, cookies, or the Planet Lab database.', ''))

    def test_watcher_has_coloured_start_and_finish(self):
        watcher = (ROOT / 'scripts/release_watcher.py').read_text()
        for marker in ('DEPLOYMENT START', 'DEPLOYMENT', 'FAILED',
                       "'ERROR'", "'WARN'", "'SUCCESS'", 'NO_COLOR', 'GitHub: ', 'Full release log: '):
            self.assertIn(marker, watcher)


if __name__ == '__main__':
    unittest.main()

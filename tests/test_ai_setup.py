"""Offline contracts for session-only BYOK setup; no real Meta calls."""
import re
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
class BrowserAISetup(unittest.TestCase):
    def test_ui_and_explicit_actions(self):
        h=(ROOT/'index.html').read_text();js=(ROOT/'ai-connections.mjs').read_text()
        for id in ('aiMetaKey','aiMetaModel','aiSetupOpen','aiSetupTop','aiSetupBackdrop','aiSessionSave','aiTestKey','aiStartDesign'):
            self.assertIn('id="'+id+'"',h)
        self.assertIn("'/api/ai/connection-test'",js)
        self.assertNotRegex(js,re.compile(r'(?<!\w)(?:window\.)?(?:localStorage|sessionStorage)\s*\.'))
        self.assertIn('X-PlanetLab-Meta-Key',js)
    def test_backend_user_key_and_auth(self):
        a=(ROOT/'backend/ai_routes.py').read_text()
        self.assertIn("def provider_for_request(name)",a)
        self.assertIn("def ai_connection_test()",a)
        self.assertIn('signed_in(db)',a)
        self.assertIn("required(data_dir, name)",a)  # existing admin fallback
        self.assertIn("provider_for_request('meta')",a)
        self.assertIn('class ClientProviderInputError(IntegrationError)',a)
        self.assertIn('return fail(str(exc), 400)',a)
        self.assertIn("return ai_error(exc, 'Provider response could not be read')",a)
if __name__=='__main__':unittest.main()

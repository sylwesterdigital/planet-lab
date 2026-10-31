"""Offline safety and wire-up checks for request-scoped diagnostics."""
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
class ApiConsoleTests(unittest.TestCase):
    def test_console_controls_and_resizable_panel(self):
        html=(ROOT/'index.html').read_text()
        for name in ('apiConsole', 'apiConsoleHandle', 'apiLogList', 'apiLogDetail',
                     'apiLogCopy', 'apiLogExport', 'apiLogMore', 'apiLogLess',
                     'apiLogFilter', 'apiConsoleAi', 'apiConsoleTop'):
            self.assertIn('id="'+name+'"',html)
        self.assertIn('resize:both',html)
    def test_all_ai_http_paths_use_the_inspector(self):
        frontend=(ROOT/'ai-connections.mjs').read_text()
        studio=(ROOT/'studio.mjs').read_text()
        self.assertIn("tracedFetch('/api/ai/connection-test'",frontend)
        self.assertIn('tracedFetch(path,',studio)
        self.assertIn('openApiConsole()',frontend)
    def test_keys_not_persisted_or_exported(self):
        console=(ROOT/'api-console.mjs').read_text()
        self.assertIn('REDACTED',console)
        self.assertIn('X-PlanetLab-Debug',console)
        self.assertIn('redact(record)',console)
        self.assertNotIn('localStorage',console)
        self.assertNotIn('sessionStorage',console)
    def test_upstream_trace_is_opt_in_and_redacts_credentials(self):
        server=(ROOT/'backend/integrations.py').read_text()
        app=(ROOT/'backend/app.py').read_text()
        self.assertIn("request.headers.get('X-PlanetLab-Debug') == '1'",server)
        self.assertIn("'Authorization': '[REDACTED]'",server)
        self.assertIn("preview.replace(settings['api_key'], '[REDACTED]')",server)
        self.assertIn("payload['_trace'] = record",app)

if __name__=='__main__':unittest.main()

"""Fast standalone contracts for first-run auth; no server dependencies required."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class FirstRunAuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (ROOT / 'index.html').read_text()
        cls.collab = (ROOT / 'collab.mjs').read_text()
        cls.studio = (ROOT / 'studio.mjs').read_text()
        cls.backend = (ROOT / 'backend/app.py').read_text()

    def test_first_load_auth_overlay_exists(self):
        for marker in ('id="authBackdrop"', 'aria-modal="true"', 'id="authTabRegister"',
                       'id="authTabLogin"', 'id="authForm"', 'id="authMessage"',
                       'id="authRetry"', 'id="accountSignout"'):
            self.assertIn(marker, self.html)

    def test_old_side_panel_login_removed(self):
        for marker in ('id="register"', 'id="login"', 'id="logout"',
                       'id="handle"', 'id="password"'):
            self.assertNotIn(marker, self.html)

    def test_login_and_register_share_one_form(self):
        self.assertIn("authMode==='register'?'/api/register':'/api/login'", self.collab)
        self.assertIn('await bootAuth()', self.collab)
        self.assertIn('const user=await sessionInfo()', self.collab)
        self.assertIn("if(user.user){hideAuth();}",self.collab)

    def test_cookies_and_token_not_local_storage(self):
        self.assertIn('session.permanent = True', self.backend)
        self.assertIn('PERMANENT_SESSION_LIFETIME=timedelta(days=30)',self.backend)
        self.assertNotRegex(self.collab, re.compile(r'localStorage|sessionStorage'))

    def test_studio_uses_shared_session_to_avoid_csrf_race(self):
        self.assertIn("planetlab:auth-changed",self.collab)
        self.assertIn("planetlab:auth-changed",self.studio)
        self.assertNotIn("setTimeout(()=>studioAction(refreshAuth),700)",self.studio)


if __name__=='__main__':
    unittest.main()

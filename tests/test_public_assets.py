"""Dependency-free guard against accidental public release-file exposure."""
import ast
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class PublicAssetPolicyTest(unittest.TestCase):
    def test_allowlist_only_contains_existing_frontend_files(self):
        source = (ROOT / 'backend/app.py').read_text()
        tree = ast.parse(source)
        assignment = next(node for node in tree.body
                          if isinstance(node, ast.Assign)
                          and any(isinstance(target, ast.Name) and target.id == 'PUBLIC_ASSETS'
                                  for target in node.targets))
        self.assertIsInstance(assignment.value, ast.Call)
        assets = ast.literal_eval(assignment.value.args[0])
        self.assertGreater(len(assets), 8)
        for asset in assets:
            with self.subTest(asset=asset):
                self.assertTrue((ROOT / asset).is_file())
                self.assertTrue(asset in {'index.html', 'house/index.html', 'updates.json'}
                                or (asset.count('/') == 0 and asset.endswith('.mjs')))
        for secret in ('README.md', 'backend/app.py', 'scripts/install-ubuntu.sh',
                       '.git/config', 'updates/processed/something.zip',
                       'test-planner.mjs', '.planetlab/deployed.json'):
            self.assertNotIn(secret, assets)
        self.assertIn('if filename not in PUBLIC_ASSETS:', source)


if __name__ == '__main__':
    unittest.main()

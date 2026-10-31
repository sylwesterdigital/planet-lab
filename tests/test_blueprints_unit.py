"""Blueprint validation works without Flask or database dependencies."""
import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.blueprints import MAX_PLAN, valid_blueprint


class BlueprintValidationTest(unittest.TestCase):
    def test_basic_blueprints_are_accepted(self):
        self.assertTrue(valid_blueprint({'config': {}}))
        self.assertTrue(valid_blueprint({'config': {'seed': 'ODYSSEY-7'},
                                         'place': {'starred': False}, 'tasks': []}))
        self.assertTrue(valid_blueprint({'config': {}, 'customFutureField': {'any': [1, 2]}}))

    def test_malformed_structures_are_rejected(self):
        for value in (None, [], {}, {'config': None}, {'config': []},
                      {'config': {}, 'place': []}, {'config': {}, 'place': None}):
            with self.subTest(value=value):
                self.assertFalse(valid_blueprint(value))

    def test_nonfinite_json_and_invalid_values_are_rejected(self):
        for number in (float('nan'), float('inf'), float('-inf')):
            with self.subTest(number=number):
                self.assertFalse(valid_blueprint({'config': {}, 'value': number}))
        self.assertFalse(valid_blueprint({'config': {}, 'value': object()}))

    def test_utf8_byte_size_limit(self):
        # Unicode characters can consume multiple bytes each.
        self.assertTrue(valid_blueprint({'config': {}, 'name': 'A' * 300_000}))
        self.assertFalse(valid_blueprint({'config': {}, 'name': '🌎' * (MAX_PLAN // 4)}))


if __name__ == '__main__':
    unittest.main()

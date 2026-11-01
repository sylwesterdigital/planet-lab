"""Regression tests for a Meta response that consumed its reasoning budget."""
import unittest
from pathlib import Path
from backend.integrations import IntegrationError, extract_chat_text, building_response_format

ROOT=Path(__file__).resolve().parents[1]

class BuildingGenerationTests(unittest.TestCase):
    def test_meta_null_content_after_budget_exhaustion(self):
        response={'choices':[{'finish_reason':'length','message':{'content':None,'role':'assistant'}}]}
        with self.assertRaisesRegex(IntegrationError,'output limit'):
            extract_chat_text(response)

    def test_empty_or_refused_response_is_not_a_building(self):
        for response in ({'choices':[{'finish_reason':'stop','message':{'content':None}}]},
                         {'choices':[{'message':{'content':''}}]},
                         {'choices':[]},
                         {'choices':[{'message':{'content':None,'refusal':'No'}}]}):
            with self.subTest(response=response), self.assertRaises(IntegrationError):
                extract_chat_text(response)

    def test_text_response_and_schema(self):
        self.assertEqual(extract_chat_text({'choices':[{'finish_reason':'stop','message':{'content':'{"width":10}'}}]}),'{"width":10}')
        schema=building_response_format()
        self.assertEqual(schema['type'],'json_schema')
        fields=schema['json_schema']['schema']
        self.assertFalse(fields['additionalProperties'])
        self.assertEqual(set(fields['required']),set(fields['properties']))
        self.assertIn('interiorRooms',fields['properties'])

    def test_route_has_no_hidden_paid_retries_and_is_schema_constrained(self):
        code=(ROOT/'backend/ai_routes.py').read_text()
        self.assertIn("'response_format': building_response_format()",code)
        self.assertIn("'reasoning_effort': 'minimal' if tier == 'standard' else 'low'",code)
        self.assertIn("'max_completion_tokens': 2000 if tier == 'standard' else 3200",code)
        self.assertEqual(code[code.index('    def ai_building():'):code.index("    @app.post('/api/ai/image')")].count('provider_request('),1)
        studio=(ROOT/'studio.mjs').read_text()
        self.assertIn('s.world.studioGroup.add(buildingGroup)',studio)
        self.assertIn("button.disabled=true",studio)
        self.assertNotIn("console.error(e);openApiConsole()",studio)

if __name__=='__main__':unittest.main()

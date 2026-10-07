import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api_backlog import response_hints

class ApiBacklogTests(unittest.TestCase):
    def test_only_selected_method_and_actual_calls_are_classified(self):
        php = """<?php class Example { public function page() { $x = 'response()->json(fake)'; /* response()->json(fake); */ return view('page'); } public function api() { return response()->json(['ok' => true]); } }"""
        self.assertEqual(response_hints(php, 'page'), ['page-response'])
        self.assertEqual(response_hints(php, 'api'), ['api-response'])
        self.assertEqual(response_hints(php, 'missing'), [])

    def test_mixed_branches_and_nested_blocks_preserve_all_response_hints(self):
        php = """<?php class Example { public function both() { if ($ajax) { return $this->processResponse(['x' => function() { return '{}'; }]); } return view('page'); } }"""
        self.assertEqual(response_hints(php, 'both'), ['api-response', 'page-response'])

    def test_redirects_downloads_and_unknown_indirect_helpers_stay_separate(self):
        php = """<?php class Example { public function file() { return response()->download($path); } public function custom() { return $this->unknownHelper(); } }"""
        self.assertEqual(response_hints(php, 'file'), ['redirect-file-or-stream'])
        self.assertEqual(response_hints(php, 'custom'), [])

if __name__ == '__main__':
    unittest.main()

"""Publication must not turn missing or stale chart assets into ready lessons."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from build_extended_course import APP, validate_visual_table
from finalize_extended_course import verify_figures


class PreparedFigureTests(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        self.app = Path(self.workspace.name)
        self.folder = self.app/'studio/assets/learning-figures'
        shutil.copytree(APP/'studio/assets/learning-figures', self.folder)
        full = json.loads((APP/'content/extended-course-plan.json').read_text(encoding='utf-8-sig'))
        self.plan = {'modules': [m for m in full['modules'] if m.get('visualDataSpec')]}

    def test_reviewed_charts_and_scene_are_included(self):
        result = verify_figures(self.app, self.plan)
        self.assertEqual(len(result), 3)
        self.assertEqual({e['id'] for e in result}, {
            'commuting-active-share', 'commuting-mode-comparison', 'courtyard-actions'})
        self.assertEqual({e['materialId'] for e in result}, {'m1', 'm2'})

    def test_missing_or_modified_asset_blocks_publication(self):
        svg = self.folder/'commuting-active-share.svg'
        original = svg.read_bytes()
        svg.write_bytes(original+b'changed')
        with self.assertRaisesRegex(ValueError, 'asset changed'):
            verify_figures(self.app, self.plan)
        svg.unlink()
        with self.assertRaises(FileNotFoundError):
            verify_figures(self.app, self.plan)

    def test_matching_file_hash_cannot_hide_obsolete_data(self):
        dataset = self.folder/'commuting-survey.json'
        value = json.loads(dataset.read_text(encoding='utf-8'))
        value['rows'][0]['active'] = 31
        dataset.write_text(json.dumps(value), encoding='utf-8')
        manifest_path = self.folder/'manifest.json'
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        for entry in manifest['figures']:
            entry['datasetSHA256'] = hashlib.sha256(dataset.read_bytes()).hexdigest()
        manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'dataset differs'):
            verify_figures(self.app, self.plan)

    def test_lessons_without_figures_do_not_require_assets(self):
        self.assertEqual(verify_figures(Path('does-not-exist'), {'modules': [{'materials': []}]}), [])

    def test_june_text_cannot_disagree_with_chart_even_with_a_later_correction(self):
        module = self.plan['modules'][0]
        course = json.loads((APP/'content/courses/extended-skills.json').read_text(encoding='utf-8-sig'))
        lesson = deepcopy(next(l for l in course if l['id'] == module['id']))
        validate_visual_table(lesson, module)
        lesson['materials'][0]['text'] = lesson['materials'][0]['text'].replace(
            'June; 150; 60; 30; 60; 40%; 20%; 40%.', 'June; 150; 60; 30; 30; 40%; 20%; 40%.')
        lesson['materials'][0]['text'] += '\n\nCorrection: June had 60 car responses.'
        with self.assertRaisesRegex(ValueError, 'fixed data for June'):
            validate_visual_table(lesson, module)


if __name__ == '__main__':
    unittest.main()

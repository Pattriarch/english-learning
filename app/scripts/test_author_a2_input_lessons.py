"""Prepared A2 content constraints, without changing caches or the live profile."""
import re
import unittest
from unittest.mock import patch

import author_a2_input_lessons as a
from build_extended_course import words


class A2ContentTests(unittest.TestCase):
    def build(self, function):
        with patch.object(a, 'atomic_json') as write:
            lesson = function()
        self.assertEqual(write.call_count, 1)
        return lesson

    def test_every_complete_reference_matches_the_frozen_word_range(self):
        for build in (a.picture, a.survey):
            lesson = self.build(build)
            for exercise, spec in zip(lesson['exercises'], a.MODULES[lesson['id']]['exercisePlan']):
                bound = re.search(r'(\d+)[–-](\d+)\s*(?:английских\s*)?слов', spec['brief'])
                if bound:
                    lower, upper = map(int, bound.groups())
                    self.assertTrue(lower <= words(exercise['answers'][0]) <= upper, exercise['id'])

    def test_correction_is_revealed_only_at_the_planned_stage(self):
        lesson = self.build(a.survey)
        early = [s['body'] for s in lesson['sections']] + [e['en'] for e in lesson['examples']]
        early += [lesson['materials'][0]['text']]
        early += [e[k] for e in lesson['exercises'][:4] for k in ('prompt','context','hint','answers')]
        self.assertNotRegex(str(early).lower(), r'family pictures|семейн')
        self.assertTrue(all('m3' not in e['materialIds'] for e in lesson['exercises'][:4]))
        self.assertTrue(all('m3' in e['materialIds'] for e in lesson['exercises'][4:]))
        self.assertIn('two chose cooking, three chose photography, and one chose bike repair',
                      lesson['exercises'][4]['answers'][0].lower())

    def test_image_description_and_later_request_preserve_observation_boundary(self):
        lesson = self.build(a.picture)
        self.assertEqual(lesson['materials'][0]['figure'],
                         a.MODULES[lesson['id']]['materials'][0]['figure'])
        self.assertTrue(all('m3' not in e['materialIds'] for e in lesson['exercises'][:7]))
        self.assertEqual(lesson['exercises'][7]['materialIds'], ['m1','m3'])
        caption = lesson['exercises'][5]['answers'][0].lower()
        self.assertNotIn('return', caption)
        self.assertNotIn('drinking', caption)
        self.assertIn('does not show', caption)


if __name__ == '__main__':
    unittest.main()

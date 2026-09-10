"""Regression checks for explicitly reviewed dictionary segmentation."""
import copy
import unittest
from unittest.mock import patch

import review_phrasal_dictionary as review


class DictionaryReviewTests(unittest.TestCase):
    def test_homonyms_remain_separate_and_all_unit_references_are_kept(self):
        entries = review.entries_for_column(
            'take off to leave the ground 12, 62 take off to become successful 27',
            [['take off', [12, 62]], ['take off', [27]]], 199, 2)
        self.assertEqual(len(entries), 2)
        self.assertNotEqual(entries[0]['id'], entries[1]['id'])
        self.assertEqual(entries[0]['unitIds'], ['phrasal-intermediate-012', 'phrasal-intermediate-062'])
        self.assertNotEqual(entries[0]['definition'], entries[1]['definition'])

    def test_alias_is_not_given_an_invented_unit(self):
        entries = review.entries_for_column('take round see take around',
            [['take round', [], {'crossReference': 'take around'}]], 199, 3)
        self.assertEqual(entries[0]['crossReference'], 'take around')
        self.assertEqual(entries[0]['unitIds'], [])

    def test_missing_or_wrong_reference_fails_instead_of_assigning_other_entry(self):
        for text in ('work out to exercise', 'work out to exercise 58'):
            with self.assertRaises(ValueError):
                review.entries_for_column(text, [['work out', [57]]], 202, 1)

    def test_unassigned_text_cannot_be_silently_dropped(self):
        with self.assertRaises(ValueError):
            review.entries_for_column('work out to exercise 57 extra unreviewed text',
                [['work out', [57]]], 202, 1)

    def test_display_headwords_remove_only_separator_line_wrap_spaces(self):
        entry = review.entries_for_column('off- putting adj unpleasant 15',
            [['off- putting', [15]]], 194, 1)[0]
        self.assertEqual(entry['headword'], 'off-putting')
        self.assertEqual(entry['sourceHeadword'], 'off- putting')
        self.assertEqual(entry['sourceText'], 'off- putting adj unpleasant 15')
        self.assertEqual(entry['partOfSpeech'], 'adjective')

    @unittest.skipUnless(review.SOURCE.exists() and review.REVIEW.exists(), 'Private reviewed dictionary corpus absent')
    def test_full_review_is_idempotent_preserves_ocr_and_covers_actual_columns(self):
        source = review.read(review.SOURCE)
        sheet = review.read(review.REVIEW)
        original = copy.deepcopy(source)
        with patch.object(review, 'sha', return_value='checked-render-hash'):
            once = review.apply_review(source, sheet)
            twice = review.apply_review(once, sheet)
        self.assertEqual(source, original)
        self.assertTrue(once['quality']['verification']['allTextVerified'])
        self.assertEqual(once['quality']['verification']['pdfPages'], list(range(179, 203)))
        self.assertEqual(once['quality']['verification']['dictionaryEntries'], 1072)
        self.assertEqual(once['quality']['verification']['sourceIssueCount'], 2)
        self.assertEqual(once['quality']['verification']['sourceNoteCount'], 1)
        self.assertIn('All 24 dictionary pages', once['quality']['confidenceNote'])
        self.assertIn('Numeric OCR confidence is unavailable', once['quality']['confidenceNote'])
        self.assertEqual(once['text'], twice['text'])
        ids = []
        for before, after, repeated in zip(source['pageTexts'], once['pageTexts'], twice['pageTexts']):
            for key in ('ocrText', 'lines', 'layoutRows', 'layoutText', 'rowLayoutText'):
                self.assertEqual(before.get(key), after.get(key), (before['page'], key))
            self.assertEqual(after['dictionaryEntries'], repeated['dictionaryEntries'])
            ids.extend(e['id'] for e in after['dictionaryEntries'])
        self.assertEqual(len(ids), len(set(ids)))
        last = once['pageTexts'][-1]
        self.assertEqual(len(last['columnTexts']), 2)
        self.assertEqual(len(last['dictionaryEntries']), 16)
        hide = next(e for p in once['pageTexts'] if p['page'] == 187
                    for e in p['dictionaryEntries'] if e['headword'] == 'hide away')
        self.assertEqual(hide['continuedInPage'], 188)
        self.assertEqual(hide['unitReferences'], [66])
        about = next(e for p in once['pageTexts'] if p['page'] == 186
                     for e in p['dictionaryEntries'] if e['headword'] == 'go about doing sth')
        self.assertEqual(about['sourceNotes'][0]['kind'], 'dictionary-confirmed-regional-variant')
        self.assertNotIn('sourceIssues', about)
        self.assertNotIn('teachingUse', about)

    @unittest.skipUnless(review.SOURCE.exists() and review.REVIEW.exists(), 'Private reviewed dictionary corpus absent')
    def test_partial_review_never_claims_full_verification(self):
        source = review.read(review.SOURCE)
        sheet = review.read(review.REVIEW)
        with patch.object(review, 'sha', return_value='checked-render-hash'):
            result = review.apply_review(source, {'202': sheet['202']})
        self.assertFalse(result['quality']['verification']['allTextVerified'])
        self.assertEqual(result['quality']['verification']['pdfPages'], [202])
        self.assertEqual(len(result['quality']['verification']['remainingPages']), 23)
        self.assertIn('1 of 24 dictionary pages', result['quality']['confidenceNote'])


if __name__ == '__main__':
    unittest.main()

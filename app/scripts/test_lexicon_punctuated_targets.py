"""Exact punctuation in lexical headings must not force endless redrafting."""
import unittest

import enrich_lexicon as full
from test_enrich_lexicon import analysis


class PunctuatedTargetTests(unittest.TestCase):
    def test_tldr_exact_heading_with_unicode_offsets(self):
        text = '📝 TL;DR: The server is ready.'
        self.assertEqual(full.full_target_spans(text, 'TL;DR'),
                         [{'start': 3, 'end': 8, 'text': 'TL;DR'}])
        self.assertEqual(full.full_target_spans('Use «tl;dr» before the summary.', 'TL;DR'),
                         [{'start': 5, 'end': 10, 'text': 'tl;dr'}])

    def test_literal_punctuation_never_accepts_shortened_or_containing_words(self):
        for text in ['Use TLDR here.', 'Use TL DR here.', 'Use XTL;DR here.',
                     'Use TL;DRs here.', 'Use pre-TL;DR here.', "Use TL;DR's here."]:
            with self.subTest(text=text):
                self.assertEqual(full.full_target_spans(text, 'TL;DR'), [])
        self.assertEqual(full.full_target_spans('A snaggle tooth.', 'snag'), [])

    def test_tldr_complete_analysis_can_name_the_real_target(self):
        text = 'TL;DR: The update fixed the issue. Details are below.'
        source = {'rowId': 'phrase:example', 'word': 'TL;DR', 'displayHeadword': 'TL;DR',
                  'en': text, 'targetSpans': full.full_target_spans(text, 'TL;DR')}
        row = analysis(source)
        row['pos'] = 'abbreviation'
        self.assertEqual(full.validate_rows([row], [source]), [row])
        for target in ['TLDR', 'TL DR', 'TL;DRs']:
            row['productionTask'] = ('Напишите коллеге два предложения о результате другой проверки. '
                                     f'Используйте заголовок {target} перед собственным кратким резюме.')
            with self.subTest(target=target), self.assertRaisesRegex(ValueError, 'omits target'):
                full.validate_rows([row], [source])


if __name__ == '__main__':
    unittest.main()

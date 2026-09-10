import unittest

from audit_book_answer_lengths import inspect_exercise


class ReferenceRangeTests(unittest.TestCase):
    def exercise(self, prompt, answer):
        return {'id': 'e1', 'prompt': prompt, 'answers': [answer]}

    def test_counts_contractions_and_numerals_by_shared_whitespace_contract(self):
        result, checked = inspect_exercise('u', self.exercise('Напишите 3–4 английских слова.', "I'm 25 today."))
        self.assertTrue(checked)
        self.assertIsNone(result)

    def test_reports_one_word_short_without_changing_text(self):
        exercise = self.exercise('Ориентировочно 4–5 слов.', 'One two three')
        result, checked = inspect_exercise('u', exercise)
        self.assertTrue(checked)
        self.assertEqual((result['count'], result['lower'], result['upper']), (3, 4, 5))
        self.assertEqual(exercise['answers'], ['One two three'])

    def test_ignores_timing_range_and_accepts_multiline_dialogue(self):
        result, checked = inspect_exercise('u', self.exercise('20–30 секунд; 4-6 английских слов.', '“Will they?”\n“Yes, they will.”'))
        self.assertTrue(checked)
        self.assertIsNone(result)

    def test_ambiguous_or_reversed_ranges_are_not_automatic_candidates(self):
        for prompt in ['3–4 слов, затем 5–6 слов.', '5–3 слов.', 'Поговорите 30–40 секунд.']:
            with self.subTest(prompt=prompt):
                self.assertEqual(inspect_exercise('u', self.exercise(prompt, 'one')), (None, False))

    def test_per_message_range_is_not_compared_with_combined_total(self):
        exercise = self.exercise('Напишите два сообщения по 2–3 английских слова каждое.', 'Hello Maya.\n\nDear Ali.')
        self.assertEqual(inspect_exercise('u', exercise), (None, False))


if __name__ == '__main__':
    unittest.main()

import unittest
from audit_book_reference_counts import inspect_lesson


class ReferenceCountAuditTests(unittest.TestCase):
    def test_all_explicit_phrasings_report_actual_count(self):
        for prefix in ('Образец содержит', 'В образце', 'Ответ содержит', 'В ответе', 'Модель содержит', 'В модели'):
            lesson = {'exercises': [{'id':'e6', 'answers':['We met 6 people.'],
                'prompt':'Напишите 3–6 слов.', 'explanation':f'{prefix} 8 слов.'}]}
            result = inspect_lesson('unit', lesson)
            self.assertEqual(result[0]['count'], 4)
            self.assertEqual(result[0]['difference'], -4)
            self.assertEqual(lesson['exercises'][0]['explanation'], f'{prefix} 8 слов.')

    def test_correct_count_including_numeral_is_not_flagged(self):
        self.assertEqual(inspect_lesson('unit', {'exercises':[
            {'answers':['We met 6 people.'], 'explanation':'Ответ содержит 4 слова.'}]}), [])

    def test_ranges_and_approximate_claims_are_not_exact_claims(self):
        self.assertEqual(inspect_lesson('unit', {'exercises':[
            {'answers':['Short answer.'], 'explanation':'Нужно написать 80–100 слов. В ответе около 90 слов.'}]}), [])

    def test_threshold_and_missing_answers(self):
        lesson = {'exercises':[{'answers':[], 'explanation':'Ответ содержит 8 слов.'},
            {'answers':['We met 6 people.'], 'explanation':'Ответ содержит 5 слов.'}]}
        self.assertEqual(inspect_lesson('unit', lesson, 3), [])
        self.assertEqual(len(inspect_lesson('unit', lesson, 1)), 1)


if __name__ == '__main__':
    unittest.main()

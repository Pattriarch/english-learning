import unittest
from audit_book_required_sources import inspect_lesson, attach_review, evidence_hash


class RequiredSourceAuditTests(unittest.TestCase):
    def test_external_source_requests_are_review_candidates(self):
        for prompt in ('Прослушайте запись и перескажите услышанное.',
                       'Опишите человека на фотографии.',
                       'Прочитайте статью и объясните доводы автора.',
                       'Найдите исходный текст в книге.',
                       'Watch the video and describe the argument.'):
            self.assertEqual(len(inspect_lesson('unit', {'exercises':[{'prompt':prompt}]})), 1, prompt)

    def test_embedded_context_is_retained_for_human_review(self):
        lesson = {'exercises':[{'id':'e3','prompt':'Прочитайте текст и кратко ответьте.',
            'context':'Here is the complete supplied text.','answers':['A reference answer.']}]}
        candidate = inspect_lesson('unit', lesson)[0]
        self.assertEqual(candidate['context'], 'Here is the complete supplied text.')
        self.assertNotIn('isDefect', candidate)

    def test_recording_own_answer_is_not_a_missing_source(self):
        self.assertEqual(inspect_lesson('unit', {'exercises':[
            {'prompt':'Запишите голосом ответ и объясните свою позицию.'}]}), [])

    def test_review_is_invalidated_if_required_context_changes(self):
        candidate = {'unit':'unit','exercise':'e1','prompt':'Прочитайте текст.', 'context':'The complete passage.'}
        reviews = {'unit/e1':{'evidenceHash':evidence_hash(candidate), 'verdict':'self-contained'}}
        self.assertIn('review', attach_review(dict(candidate), reviews))
        candidate['context'] = ''
        self.assertNotIn('review', attach_review(candidate, reviews))


if __name__ == '__main__':
    unittest.main()

"""Regression checks for locally reviewed, user-supplied appendix extracts.

Private PDFs/OCR are not fixtures committed to the repository. A source-free
checkout skips these tests; a local import must pass them before reuse.
"""
import json
from pathlib import Path
import re
import unittest

DATA = Path(__file__).resolve().parents[1] / 'data/parsed-book-supplements'


class ReviewedAppendixTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        identifiers = [f'grammar-advanced-appendix-{n:02}' for n in (1, 2, 3, 4, 5, 6)]
        identifiers.append('grammar-intermediate-appendix-09')
        if any(not (DATA / (identifier+'.json')).exists() for identifier in identifiers):
            raise unittest.SkipTest('Private local appendix extracts are not present')
        cls.records = {identifier:json.loads((DATA / (identifier+'.json')).read_text(encoding='utf-8')) for identifier in identifiers}

    def test_verified_flags_require_the_whole_appendix_page_range(self):
        for identifier, record in self.records.items():
            if identifier.endswith('09'):
                continue
            expected = list(range(record['pages'][0],record['pages'][1]+1))
            self.assertEqual(record['quality']['verification']['pdfPages'], expected)
            self.assertTrue(record['quality']['manuallyReviewed'])
            self.assertTrue(record['quality']['visualVerified'])
            self.assertEqual(record['quality']['characterCount'], len(record['text']))
            self.assertRegex(record['provenance']['reviewSourceSHA256'],r'^[0-9a-f]{64}$')

    def test_irregular_tables_preserve_all_156_complete_rows(self):
        record = self.records['grammar-advanced-appendix-01']
        rows = [row for page in record['pageTexts'] for table in page['tables'] for row in table['rows'][1:]]
        self.assertEqual(len(rows),156)
        self.assertEqual(len({re.sub(r'\[\d\]','',row[0]) for row in rows}),156)
        self.assertTrue(all(len(row)==3 and all(cell.strip() for cell in row) for row in rows))
        forms = {re.sub(r'\[\d\]','',row[0]):row for row in rows}
        self.assertEqual(forms['cast'],['cast','cast','cast'])
        self.assertEqual(forms['read'],['read','read[5]','read[5]'])
        self.assertEqual(forms['light'][1:],['lit','lit'])
        for marker in range(1,6):
            self.assertRegex(record['pageTexts'][1]['footnotes'],rf'(?m)^{marker} ')

    def test_passive_examples_are_separate_from_wrapped_formulas(self):
        rows = self.records['grammar-advanced-appendix-02']['pageTexts'][0]['tables'][0]['rows'][1:]
        self.assertEqual(len(rows),24)
        self.assertTrue(all(len(row)==4 and all(row) for row in rows))
        self.assertTrue(rows[-2][2].endswith('have been telling'))
        self.assertTrue(rows[-1][2].endswith('have been being told'))
        self.assertTrue(rows[-2][3].endswith('telling John while I was outside.'))
        self.assertTrue(rows[-1][3].endswith('told while I was outside.'))
        self.assertEqual(sum('rare in the passive' in row[0] for row in rows),2)

    def test_glossary_has_all_56_terms_and_explicit_source_error_note(self):
        record = self.records['grammar-advanced-appendix-03']
        entries = [entry for page in record['pageTexts'] for entry in page['glossaryEntries']]
        self.assertEqual(len(entries),56)
        self.assertEqual(len({entry['term'] for entry in entries}),56)
        self.assertTrue(all(len(entry['definition'])>20 for entry in entries))
        self.assertNotIn('outsideyour',record['text'])
        self.assertNotIn('lookedafter',record['text'])
        self.assertIn('source error',record['quality']['sourceNotes'][0])

    def test_all_raw_ocr_and_previous_text_are_retained(self):
        for identifier, record in self.records.items():
            if identifier.endswith('09'):
                continue
            self.assertTrue(record['preReviewText'])
            for page in record['pageTexts']:
                self.assertTrue(page['preReviewText'])
                self.assertTrue(page['ocrText'])
                self.assertTrue(page['lines'])

    def test_diagnostic_has_160_verified_questions_but_no_invented_answer_key(self):
        record = self.records['grammar-intermediate-appendix-09']
        refs = {item['question']:item for page in record['pageTexts'] for item in page['studyUnitReferences']}
        self.assertEqual(len(refs),160)
        self.assertEqual(refs['1.3']['studyUnits'],[2,3,110])
        self.assertEqual(refs['15.17']['studyUnits'],[136,59])
        self.assertEqual(refs['16.9']['unitIds'],['grammar-intermediate-145'])
        self.assertTrue(all(1<=unit<=145 for item in refs.values() for unit in item['studyUnits']))
        questions=[q for page in record['pageTexts'] for q in page['diagnosticQuestions']]
        self.assertEqual(len(questions),160)
        self.assertEqual(len({q['id'] for q in questions}),160)
        self.assertTrue(all(q['prompt'].count('_____')==1 and 2<=len(q['options'])<=5 for q in questions))
        self.assertTrue(record['quality']['manuallyReviewed'])
        self.assertTrue(record['quality']['allTextVerified'])
        self.assertEqual(record['answerKey']['status'],'not-reviewed')
        self.assertFalse(record['answerKey']['included'])
        self.assertTrue(all(not q['answerKeyVerified'] and 'answer' not in q and 'correct' not in q for q in questions))
        duplicate=next(q for q in questions if q['id']=='4.2')
        self.assertEqual([o['label'] for o in duplicate['options']],['A','B','B'])
        self.assertEqual([o['position'] for o in duplicate['options']],[1,2,3])
        self.assertTrue(all(p['originalExtraction']['text'] and p['fullPageOCR'] for p in record['pageTexts']))

    def test_advanced_study_preserves_two_reference_columns_and_multiple_blanks(self):
        record=self.records['grammar-advanced-appendix-04']
        questions=[q for page in record['pageTexts'] for q in page['diagnosticQuestions']]
        by_id={q['id']:q for q in questions}
        self.assertEqual(len(questions),159)
        self.assertEqual(len(by_id),159)
        self.assertTrue(all(len(q['options'])==4 and q['blankCount']==q['prompt'].count('_____') for q in questions))
        self.assertEqual(sum(q['blankCount']==2 for q in questions),16)
        self.assertEqual(by_id['6.1']['grammarReminderIds'],['G4','G5'])
        self.assertEqual(by_id['8.12']['grammarReminderIds'],['I34']+[f'I{n}' for n in range(22,29)])
        self.assertEqual(by_id['8.2']['studyUnits'],[45,46,47])
        self.assertEqual(by_id['4.5']['supplementIds'],['grammar-advanced-appendix-02'])
        self.assertEqual(by_id['7.1']['studyUnits'],[])
        self.assertEqual(by_id['7.1']['grammarReminderIds'],['H1'])
        self.assertFalse(record['answerKey']['included'])
        self.assertTrue(all(not q['answerKeyVerified'] for q in questions))

    def test_grammar_reminder_restores_all_211_targets_and_table_columns(self):
        record=self.records['grammar-advanced-appendix-05']
        targets={point['id'] for page in record['pageTexts'] for point in page['referencePoints']}
        self.assertEqual(len(targets),211)
        expected={c+str(n) for c,count in zip('ABCDEFGHIJKLM',[18,8,32,3,7,13,11,12,52,10,12,11,22]) for n in range(1,count+1)}
        self.assertEqual(targets,expected)
        refs={ref for page in self.records['grammar-advanced-appendix-04']['pageTexts'] for q in page['diagnosticQuestions'] for ref in q['grammarReminderIds']}
        self.assertTrue(refs<=targets)
        self.assertEqual(sum(len(page.get('tables',[])) for page in record['pageTexts']),10)
        self.assertEqual(len(re.findall(r'(?m)^\[[A-M]\d+\]',record['text'])),211)
        self.assertIn('/səm/',record['text'])
        self.assertIn('/sʌm/',record['text'])
        self.assertIn('Original: \'I grew these carrots myself.\'\nReported:',record['text'])
        self.assertNotIn('Weitherdid',record['text'])

    def test_additional_groups_preserve_matching_lists_blanks_and_source_examples(self):
        record=self.records['grammar-advanced-appendix-06']
        groups=record['exerciseGroups']
        self.assertEqual([g['number'] for g in groups],list(range(1,17)))
        self.assertEqual(sum(g['itemCount'] for g in groups),197)
        self.assertEqual(groups[0]['pdfPages'],[251])
        self.assertEqual(groups[2]['pdfPages'],[252,253])
        self.assertEqual(groups[6]['pdfPages'],[255])
        self.assertEqual(groups[8]['pdfPages'],[256,257])
        self.assertEqual(groups[9]['pdfPages'],[257,258])
        self.assertEqual(groups[8]['text'].count('_____'),30)
        self.assertEqual(groups[9]['text'].count('_____'),30)
        self.assertEqual(groups[0]['text'].count('_____'),19)
        self.assertEqual(len(record['pageTexts'][1]['tables'][0]['rows']),8)
        matching=record['pageTexts'][9]['tables'][0]
        self.assertEqual(len(matching['left']),10)
        self.assertEqual(len(matching['right']),10)
        self.assertEqual(matching['right']['f'],'leave the carrots to cool for a few minutes')
        self.assertFalse(matching['matchedAnswersIncluded'])
        self.assertEqual(groups[7]['sourceExamples'][1]['kind'],'partial')
        self.assertEqual(groups[15]['sourceExamples'][0]['text'],'Little did I imagine that the boss had called me into her office to fire me.')
        self.assertIn('*does* her train *go*',groups[3]['text'])
        self.assertIn('*agree* [example insertion: with]',groups[14]['text'])
        self.assertTrue(all(not g['answerKeyVerified'] for g in groups))
        self.assertFalse(record['answerKey']['included'])


if __name__ == '__main__':
    unittest.main()

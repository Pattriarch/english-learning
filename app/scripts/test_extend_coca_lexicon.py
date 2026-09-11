"""Offline contracts for additive source import; never use learner or model data."""
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import extend_coca_lexicon as extension
from build_context_lexicon import lexical_id, validate_entries


def original_row(word='snag'):
    return {
        'word': word, 'pos': 'noun', 'meaningEn': 'An unexpected difficulty.',
        'meaningRu': 'Неожиданная трудность.',
        'en': f'We hit a {word} while moving our files to the new server.',
        'ru': 'При переносе файлов на новый сервер мы столкнулись с трудностью.',
        'phrase': f'hit a {word}', 'explanation': 'В этом контексте речь о препятствии в работе.',
        'task': f'Напиши коллеге два предложения о неожиданной трудности и следующем шаге, используя слово «{word}».',
        'topicId': 'work', 'topicTitle': 'Работа', 'registerTags': [],
    }


class WordListReadingTests(unittest.TestCase):
    def test_utf16_word_list_ignores_suffix_and_retains_source_forms(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'words.wslx'
            path.write_bytes('<?xml version="1.0" encoding="UTF-16"?><wsl><wss><w>Cat</w><w> cats </w><w>it’s</w><w>cats</w></wss></wsl>'.encode('utf-16'))
            self.assertEqual(extension.read_wsl(path), ['Cat', 'cats', 'it’s', 'cats'])

    def test_doctype_is_rejected_in_utf8_and_utf16(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'words.wslx'
            text = '<!DOCTYPE wsl [<!ENTITY sample "cat">]><wsl><wss><w>&sample;</w></wss></wsl>'
            for encoding in ['utf-8', 'utf-16']:
                with self.subTest(encoding=encoding):
                    path.write_bytes(text.encode(encoding))
                    with self.assertRaisesRegex(ValueError, 'Document types'):
                        extension.read_wsl(path)

    def test_wrong_root_missing_words_and_empty_rows_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'words.wslx'
            for text in ['<other><wss><w>cat</w></wss></other>', '<wsl/>', '<wsl><wss><w> </w></wss></wsl>']:
                with self.subTest(text=text):
                    path.write_text(text, encoding='utf-8')
                    with self.assertRaises(ValueError):
                        extension.read_wsl(path)


class LexicalRowTests(unittest.TestCase):
    def test_dotted_headwords_match_literal_punctuation_and_utf16_offsets(self):
        for word in ['Mr.', 'M.D.', 'Ph.D.', 'a.m.']:
            with self.subTest(word=word):
                text = '😀 ' + word + ' is the target.'
                self.assertEqual(extension.context_spans(text, word), [{'start': 3, 'end': 3 + len(word), 'text': word}])
                self.assertEqual(extension.context_spans(text, word.swapcase())[0]['text'], word)
                for invalid in ['A' + word + ' here', 'é' + word + ' here', "x'" + word + ' here', 'x-' + word + ' here', word + 'x here', word + '-suffix', word[:-1] + ' here']:
                    with self.subTest(invalid=invalid):
                        self.assertEqual(extension.context_spans(invalid, word), [])

    def test_regular_contexts_keep_existing_unicode_whole_token_matching(self):
        from build_context_lexicon import target_spans
        for text, word in [('The Sámi community lives here.', 'mi'), ('The República district is large.', 'rep'), ('A café opens early.', 'café'), ("We can't attend today.", "can't"), ('An issue arose, but issues differ.', 'issue')]:
            with self.subTest(text=text, word=word):
                self.assertEqual(extension.context_spans(text, word), target_spans(text, word))
        self.assertEqual(extension.context_spans('The Sámi community lives here.', 'mi'), [])

    def test_dotted_headword_validation_and_entry_share_the_same_spans(self):
        row = {**original_row('a.m.'), 'en': '😀 Our meeting starts at 9 a.m. tomorrow.', 'phrase': '9 a.m.', 'pos': 'abbreviation'}
        self.assertEqual(extension.validate_rows([row], [{'headword': 'a.m.'}]), [row])
        source = {'id': extension.EDITORIAL_ID, 'license': 'original-project-content', 'author': 'Separate AI review'}
        receipt = {'inputSHA256': 'a' * 64, 'reviewSHA256': 'b' * 64, 'reviewPasses': 1}
        entry = extension.make_entry(row, receipt, source, 1)
        self.assertEqual(entry['contexts'][0]['targetSpans'], extension.context_spans(row['en'], 'a.m.'))
        validate_entries({'spanEncoding': 'utf-16', 'entries': [entry]}, [source, {'id': extension.SOURCE_ID}])
        bad = {**row, 'en': 'Our meeting starts at 9 am tomorrow.', 'phrase': '9 am'}
        with self.assertRaisesRegex(ValueError, 'Missing exact target'):
            extension.validate_rows([bad], [{'headword': 'a.m.'}])

    def test_output_identifier_repair_requires_an_explicit_unambiguous_pair(self):
        inputs = [{'word': 'am', 'headword': 'a.m.'}]
        self.assertEqual(extension.output_word('am', inputs), 'a.m.')
        self.assertEqual(extension.output_word('AM', inputs), 'a.m.')
        self.assertEqual(extension.output_word('A.M.', inputs), 'a.m.')
        self.assertEqual(extension.output_word('a-m', inputs), 'a-m')
        self.assertEqual(extension.output_word('pm', inputs), 'pm')
        self.assertEqual(extension.output_word('am', [{'headword': 'a.m.'}]), 'am')
        self.assertEqual(extension.output_word('am', inputs + [{'word': 'am', 'headword': 'AM-radio'}]), 'am')
        row = {**original_row('a.m.'), 'word': extension.output_word('unknown', inputs)}
        with self.assertRaisesRegex(ValueError, 'every distinct headword'):
            extension.validate_rows([row], inputs)

    def test_exact_word_set_required_and_highlight_must_be_whole_word(self):
        row = original_row()
        inputs = [{'headword': 'snag'}]
        self.assertEqual(extension.validate_rows([row], inputs), [row])
        for rows in [[], [row, row], [{**row, 'word': 'other'}], [{**row, 'en': 'A snagged sweater needs repair.', 'phrase': 'snagged sweater'}]]:
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                extension.validate_rows(rows, inputs)

    def test_missing_fields_collocation_topic_and_register_types_are_rejected(self):
        row = original_row()
        cases = [{'meaningEn': ' '}, {'ru': None}, {'phrase': 'not in the example'}, {'topicId': '../topic'}, {'registerTags': ['formal', 1]}, {'registerTags': 'formal'}]
        for changes in cases:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                extension.validate_rows([{**row, **changes}], [{'headword': 'snag'}])

    def test_output_task_must_explicitly_name_the_exact_learning_target(self):
        row = original_row()
        for task in ['Напиши коллеге два предложения о неожиданной трудности.',
                     'Напиши сообщение, используя слово snagged.',
                     'Опиши ситуацию и используй предыдущее слово.']:
            with self.subTest(task=task), self.assertRaisesRegex(ValueError, 'does not name its target'):
                extension.validate_rows([{**row, 'task': task}], [{'headword': 'snag'}])
        self.assertEqual(extension.validate_rows([row], [{'headword': 'snag'}]), [row])
        dotted = {**original_row('a.m.'), 'task': 'Напиши коллеге о встрече, используя am.'}
        with self.assertRaisesRegex(ValueError, 'does not name its target'):
            extension.validate_rows([dotted], [{'headword': 'a.m.'}])

    def test_published_review_passes_count_only_reviews_that_actually_checked_that_row(self):
        receipt = {'inputSHA256': 'a' * 64, 'reviewSHA256': 'b' * 64, 'reviewPasses': 3,
                   'reviews': [{'checkedWords': ['snag', 'hitch']}, {'checkedWords': ['hitch']}, {'checkedWords': ['hitch']}]}
        source = {'id': extension.EDITORIAL_ID, 'license': 'original-project-content', 'author': 'Separate AI review'}
        for word, expected in [('snag', 1), ('hitch', 3)]:
            with self.subTest(word=word):
                entry = extension.make_entry(original_row(word), receipt, source, 1)
                self.assertEqual(entry['contexts'][0]['completionReview']['reviewPasses'], expected)
                validate_entries({'spanEncoding': 'utf-16', 'entries': [entry]}, [source, {'id': extension.SOURCE_ID}])
        unchecked = extension.make_entry(original_row('obstacle'), receipt, source, 1)
        self.assertEqual(unchecked['contexts'][0]['completionReview']['reviewPasses'], 0)
        with self.assertRaisesRegex(ValueError, 'review receipt'):
            validate_entries({'spanEncoding': 'utf-16', 'entries': [unchecked]}, [source, {'id': extension.SOURCE_ID}])

    def test_generated_entry_keeps_stable_identity_and_explicit_review_scope(self):
        row = original_row()
        receipt = {'inputSHA256': 'a' * 64, 'reviewSHA256': 'b' * 64, 'reviewPasses': 2}
        source = {'id': extension.EDITORIAL_ID, 'license': 'original-project-content', 'author': 'Separate AI draft and review'}
        entry = extension.make_entry(row, receipt, source, 813)
        self.assertEqual(entry['id'], lexical_id('snag'))
        self.assertEqual(entry['rank']['sourceRow'], 813)
        self.assertIn('unverified', entry['rank']['metric'])
        self.assertIsNone(entry['cefr'])
        self.assertEqual(entry['contexts'][0]['senseId'], entry['senses'][0]['id'])
        self.assertEqual(entry['contexts'][0]['quality'], 'ai-context-reviewed')
        self.assertEqual(entry['contexts'][0]['completionReview']['reviewSHA256'], 'b' * 64)
        self.assertIn('not human', entry['contexts'][0]['alignment'])
        self.assertEqual(entry['contexts'][0]['source']['sourceId'], extension.EDITORIAL_ID)
        self.assertEqual(entry['memberships'][0]['sourceId'], extension.SOURCE_ID)
        self.assertEqual(entry['quality']['reviewedContextCount'], 0)
        validate_entries({'spanEncoding': 'utf-16', 'entries': [entry]}, [source, {'id': extension.SOURCE_ID}])


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.bank = self.root / 'bank'
        self.bank.mkdir()
        self.work = self.root / 'work'
        self.source = self.root / 'supplied.wslx'
        self.triage_path = self.root / 'triage.json'
        self.decisions_path = self.root / 'decisions.json'
        self.base_bytes = json.dumps({'entries': [{'id': 'published-cat-id', 'word': 'cat'}]}).encode('utf-8')
        (self.bank / 'entries.json').write_bytes(self.base_bytes)
        self.decisions = {'newWords': [], 'aliases': [], 'references': []}
        self.triage = []
        self.addCleanup(patch.stopall)
        patch.object(extension, 'BANK', self.bank).start()
        patch.object(extension, 'WORK', self.work).start()

    def prepare(self, words, batch_size=2):
        self.source.write_text('<wsl><wss>' + ''.join('<w>' + word + '</w>' for word in words) + '</wss></wsl>', encoding='utf-8')
        self.triage_path.write_text(json.dumps(self.triage), encoding='utf-8')
        self.decisions_path.write_text(json.dumps(self.decisions), encoding='utf-8')
        with contextlib.redirect_stdout(io.StringIO()):
            extension.prepare(self.source, self.triage_path, self.decisions_path, batch_size)
        self.assertEqual((self.bank / 'entries.json').read_bytes(), self.base_bytes)
        return json.loads((self.work / 'input.json').read_text(encoding='utf-8'))

    def test_rows_accounted_for_and_new_canonical_headword_does_not_displace_old_ids(self):
        self.triage = [{'word': 'cats', 'kind': 'form', 'forms': [{'lemma': 'cat', 'pos': 'noun', 'tags': ['plural'], 'sourceWord': 'cat'}]}]
        self.decisions['newWords'] = [{'word': 'swiftly', 'headword': 'swiftly', 'meaningHint': 'quickly'}, {'word': 'swifter', 'headword': 'swift', 'meaningHint': 'fast', 'registerNote': 'Comparative of swift'}]
        self.decisions['references'] = [{'word': 'acme', 'category': 'proper-name', 'reason': 'A supplied proper name.'}]
        result = self.prepare(['cat', 'CATS', 'swiftly', 'swifter', 'acme'])
        self.assertEqual(result['summary'], {**result['summary'], 'sourceRows': 5, 'uniqueSourceTokens': 5, 'exactExisting': 1, 'linkedForms': 1, 'newHeadwordRows': 2, 'newEntries': 2, 'referenceOnly': 1, 'unresolved': 0, 'baseWords': 1, 'totalWordsAfter': 3})
        self.assertEqual([row['sourceRow'] for row in result['auditRows']], [1, 2, 3, 4, 5])
        self.assertEqual(result['aliases'][0]['entryIds'], ['published-cat-id'])
        self.assertEqual(result['aliases'][0]['word'], 'CATS')
        self.assertEqual(result['aliases'][1]['entryIds'], [lexical_id('swift')])
        self.assertEqual(result['referenceItems'][0]['word'], 'acme')
        self.assertEqual({item['headword'] for item in result['entries']}, {'swiftly', 'swift'})
        self.assertNotIn('cefr', result['source'])

    def test_duplicate_source_forms_retain_row_audit_without_inflating_new_entries(self):
        self.decisions['newWords'] = [{'word': 'snag', 'headword': 'snag', 'meaningHint': 'a difficulty'}]
        result = self.prepare(['cat', 'CAT', 'snag', 'snag'])
        self.assertEqual(result['summary']['sourceRows'], 4)
        self.assertEqual(result['summary']['uniqueSourceTokens'], 2)
        self.assertEqual(result['summary']['newHeadwordRows'], 2)
        self.assertEqual(result['summary']['newEntries'], 1)
        self.assertEqual(len(result['auditRows']), 4)

    def test_existing_canonical_target_is_linked_without_new_entry(self):
        self.decisions['newWords'] = [{'word': 'cats', 'headword': 'cat', 'meaningHint': 'plural cats'}]
        result = self.prepare(['cats'])
        self.assertEqual(result['entries'], [])
        self.assertEqual(result['summary']['linkedForms'], 1)
        self.assertEqual(result['aliases'][0]['entryIds'], ['published-cat-id'])

    def test_new_and_existing_headwords_keep_independent_inflected_readings(self):
        self.base_bytes = json.dumps({'entries': [
            {'id': 'see-original-id', 'word': 'see'}, {'id': 'fall-original-id', 'word': 'fall'},
            {'id': 'leave-original-id', 'word': 'leave'}, {'id': 'left-original-id', 'word': 'left'},
        ]}).encode('utf-8')
        (self.bank / 'entries.json').write_bytes(self.base_bytes)
        self.decisions['newWords'] = [
            {'word': 'saw', 'headword': 'saw', 'meaningHint': 'a cutting tool'},
            {'word': 'fell', 'headword': 'fell', 'meaningHint': 'to cut down a tree'},
        ]
        self.triage = [{'word': word, 'kind': 'new-lexical', 'forms': [{'lemma': lemma, 'pos': 'verb', 'tags': ['past'], 'sourceWord': lemma}]} for word, lemma in [('saw', 'see'), ('fell', 'fall'), ('left', 'leave')]]
        result = self.prepare(['saw', 'fell', 'left'])
        by_word = {row['word']: row for row in result['auditRows']}
        aliases = {row['word']: row for row in result['aliases']}
        self.assertEqual(by_word['saw']['entryIds'], [lexical_id('saw')])
        self.assertEqual(by_word['fell']['entryIds'], [lexical_id('fell')])
        self.assertEqual(by_word['left']['entryIds'], ['left-original-id'])
        for word, target in [('saw', 'see-original-id'), ('fell', 'fall-original-id'), ('left', 'leave-original-id')]:
            self.assertEqual(by_word[word]['relatedFormEntryIds'], [target])
            self.assertEqual(aliases[word]['entryIds'], [target])
        self.assertEqual(result['summary']['newEntries'], 2)
        self.assertEqual(result['summary']['exactExisting'], 1)
        self.assertEqual(result['summary']['linkedForms'], 0)

    def test_explicit_dangling_alias_and_conflicting_decisions_fail_before_snapshot(self):
        self.decisions['aliases'] = [{'word': 'kittens', 'lemmas': ['missing'], 'relation': 'Invalid target'}]
        with self.assertRaisesRegex(ValueError, 'absent target'):
            self.prepare(['kittens'])
        self.assertFalse((self.work / 'input.json').exists())
        self.decisions['newWords'] = [{'word': 'kittens', 'headword': 'kitten'}]
        with self.assertRaisesRegex(ValueError, 'Conflicting'):
            self.prepare(['kittens'])
        self.assertFalse((self.work / 'input.json').exists())

    def test_unresolved_rows_block_snapshot_and_existing_snapshot_is_not_overwritten(self):
        with self.assertRaisesRegex(ValueError, 'unclassified'):
            self.prepare(['unknown'])
        self.assertFalse((self.work / 'input.json').exists())
        self.assertEqual(len(json.loads((self.work / 'unresolved.json').read_text())), 1)
        result = self.prepare(['cat'])
        with self.assertRaisesRegex(ValueError, 'snapshot already exists'):
            self.prepare(['cat'])
        self.assertEqual(json.loads((self.work / 'input.json').read_text()), result)


class CheckpointTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.work = Path(self.directory.name)
        self.patcher = patch.object(extension, 'WORK', self.work)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def test_correction_receives_another_review_without_rechecking_unchanged_rows(self):
        inputs = [{'headword': 'snag', 'meaningHint': 'a difficulty'}, {'headword': 'hitch', 'meaningHint': 'a difficulty'}]
        initial = [original_row('snag'), original_row('hitch')]
        corrected = {**initial[0], 'meaningRu': 'Неожиданное препятствие.'}
        calls = []

        def model(prompt, payload, schema, path, timeout):
            calls.append((prompt, payload))
            if prompt == extension.DRAFT_PROMPT:
                result = {'rows': initial}
            elif len(calls) == 2:
                result = {'checkedWords': ['snag', 'hitch'], 'corrections': [corrected], 'blocked': []}
            else:
                self.assertEqual(payload['inputs'], inputs[:1])
                self.assertEqual(payload['draft'], [corrected])
                result = {'checkedWords': ['snag'], 'corrections': [], 'blocked': []}
            extension.atomic_json(path, result)
            return result

        with patch.object(extension, 'call_cli', side_effect=model):
            result = extension.generate_batch(1, inputs, 10)
        self.assertEqual(len(calls), 3)
        self.assertEqual(result['corrections'], 1)
        receipt = extension.read(self.work / 'batches/001/verified.json')
        self.assertEqual(receipt['reviewPasses'], 2)
        self.assertEqual(receipt['rows'], [corrected, initial[1]])
        self.assertEqual(receipt['reviews'][0]['checkedWords'], ['snag', 'hitch'])
        self.assertEqual(receipt['reviews'][1]['checkedWords'], ['snag'])
        with patch.object(extension, 'call_cli', side_effect=AssertionError('Verified work must resume without model calls')):
            self.assertEqual(extension.generate_batch(1, inputs, 10)['status'], 'resumed')

    def test_changed_input_cannot_reuse_an_unfinished_draft(self):
        old_inputs = [{'headword': 'snag', 'meaningHint': 'a difficulty'}]
        folder = self.work / 'batches/001'
        extension.atomic_json(folder / 'input-binding.json', {'inputSHA256': extension.value_sha(old_inputs)})
        extension.atomic_json(folder / 'draft.json', {'rows': [original_row()]})
        with patch.object(extension, 'call_cli', side_effect=AssertionError('Stale work must fail before any model call')):
            with self.assertRaisesRegex(ValueError, 'different input snapshot'):
                extension.generate_batch(1, [{'headword': 'snag', 'meaningHint': 'a dead standing tree'}], 10)

    def test_changed_draft_cannot_reuse_its_old_semantic_review(self):
        inputs = [{'headword': 'snag', 'meaningHint': 'a difficulty'}]
        initial = original_row()
        folder = self.work / 'batches/001'
        extension.atomic_json(folder / 'input-binding.json', {'inputSHA256': extension.value_sha(inputs)})
        extension.atomic_json(folder / 'draft.json', {'rows': [{**initial, 'ru': 'Новый перевод.'}]})
        extension.atomic_json(folder / 'review.request.json', {'requestSHA256': extension.value_sha({'inputs': inputs, 'draft': [initial]})})
        extension.atomic_json(folder / 'review.json', {'checkedWords': ['snag'], 'corrections': [], 'blocked': []})
        with patch.object(extension, 'call_cli', side_effect=AssertionError('Stale review must not be reused')):
            with self.assertRaisesRegex(ValueError, 'different inputs or draft rows'):
                extension.generate_batch(1, inputs, 10)

    def test_editing_verified_rows_invalidates_resume(self):
        inputs = [{'headword': 'snag', 'meaningHint': 'a difficulty'}]
        row = original_row()
        extension.atomic_json(self.work / 'batches/001/verified.json', {'inputSHA256': extension.value_sha(inputs), 'rowsSHA256': extension.value_sha([row]), 'rows': [{**row, 'meaningRu': 'Изменено после проверки.'}]})
        with patch.object(extension, 'call_cli', side_effect=AssertionError('Modified receipt must not resume')):
            with self.assertRaisesRegex(ValueError, 'rows changed after review'):
                extension.generate_batch(1, inputs, 10)

    def test_canonical_identifier_repair_retains_original_draft_and_review_files(self):
        inputs = [{'word': 'am', 'headword': 'a.m.', 'meaningHint': 'before noon'}]
        raw_row = {**original_row('a.m.'), 'word': 'am', 'en': 'The class starts at 9 a.m. every Monday.', 'phrase': '9 a.m.', 'pos': 'abbreviation'}
        files = {}

        def model(prompt, payload, schema, path, timeout):
            if prompt == extension.DRAFT_PROMPT:
                response = {'rows': [raw_row]}
            else:
                self.assertEqual(payload['draft'][0]['word'], 'a.m.')
                response = {'checkedWords': ['am'], 'corrections': [], 'blocked': []}
            extension.atomic_json(path, response)
            files[path] = path.read_bytes()
            return response

        with patch.object(extension, 'call_cli', side_effect=model):
            extension.generate_batch(1, inputs, 10)
        for path, original in files.items():
            self.assertEqual(path.read_bytes(), original)
        receipt = extension.read(self.work / 'batches/001/verified.json')
        self.assertEqual(receipt['rows'][0]['word'], 'a.m.')
        self.assertEqual(receipt['reviews'][0]['checkedWords'], ['a.m.'])
        self.assertEqual(extension.read(self.work / 'batches/001/review.json')['checkedWords'], ['am'])
        self.assertEqual(extension.read(self.work / 'batches/001/draft.json')['rows'][0]['word'], 'am')

    def test_unknown_review_identifier_never_receives_a_verified_checkpoint(self):
        inputs = [{'word': 'am', 'headword': 'a.m.', 'meaningHint': 'before noon'}]
        row = {**original_row('a.m.'), 'en': 'The class starts at 9 a.m. every Monday.', 'phrase': '9 a.m.'}

        def model(prompt, payload, schema, path, timeout):
            response = {'rows': [row]} if prompt == extension.DRAFT_PROMPT else {'checkedWords': ['pm'], 'corrections': [], 'blocked': []}
            extension.atomic_json(path, response)
            return response

        with patch.object(extension, 'call_cli', side_effect=model), self.assertRaisesRegex(ValueError, 'Incomplete semantic review'):
            extension.generate_batch(1, inputs, 10)
        self.assertFalse((self.work / 'batches/001/verified.json').exists())


if __name__ == '__main__':
    unittest.main()

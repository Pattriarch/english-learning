"""Offline publication/review contracts for the full contextual analysis overlay.

No model, learner data, service, or live content file is used by these tests.
"""
import contextlib
import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import enrich_lexicon as enrich


def source_entry(word='snag', suffix='1', *, archived=False):
    text = f'We hit a {word} while moving our files to the new server.'
    context = {
        'id': 'context-' + suffix, 'en': text,
        'ru': 'При переносе файлов на новый сервер возникла неожиданная трудность.',
        'targetSpans': enrich.context_spans(text, word),
        'senseId': 'sense-' + suffix,
        'source': {'sourceId': 'test-source', 'license': 'CC-BY-2.0', 'sentenceId': suffix},
        'quality': 'context-reviewed',
        'explanation': 'Уже существующий короткий разбор конкретного значения слова.',
    }
    if archived:
        context.update({'excludedFromStudy': True, 'exclusionReason': 'Сохранено только для истории.'})
    return {
        'id': 'entry-' + suffix, 'word': word, 'kind': 'word',
        'senses': [{'id': 'sense-' + suffix, 'pos': 'noun', 'definition': 'An unexpected difficulty.',
                    'definitionRu': 'неожиданная трудность', 'tags': []}],
        'contexts': [context],
    }


def analysis(source, *, replace=False):
    word = source['displayHeadword']
    return {
        'rowId': source['rowId'], 'action': 'replace' if replace else 'keep',
        'en': (f'Our team found a {word} in the revised plan before the meeting.' if replace else source['en']),
        'ru': 'Наша команда обнаружила неожиданную трудность в обновленном плане перед встречей.',
        'pos': 'noun', 'meaningEn': 'An unexpected difficulty that slows progress.',
        'meaningRu': 'неожиданная трудность',
        'explanation': ('Слово называет неожиданную трудность, которая мешает продвигаться по плану. '
                        'Говорящий выделяет конкретную проблему и может затем объяснить ее последствия. '
                        'Такое употребление подходит для сообщения коллеге о задержке и следующем шаге.'),
        'usageNotes': ['Используйте существительное после неопределенного артикля.',
                       'Назовите конкретную ситуацию, в которой возникла трудность.'],
        'collocations': [{'text': 'hit a ' + word, 'ru': 'столкнуться с трудностью'},
                         {'text': 'an unexpected ' + word, 'ru': 'неожиданная трудность'}],
        'commonMistakes': [{'wrong': 'We hit snag.', 'correct': 'We hit a snag.',
                            'why': 'Для одного исчисляемого препятствия в этой ситуации нужен артикль a.'}],
        'productionTask': ('Напишите коллеге два предложения о другой неожиданной трудности и предложите '
                           f'следующий шаг. Используйте слово {word} в этом значении.'),
        'replacementReason': 'В исходном примере есть фактическая ошибка, поэтому нужна отдельная замена.' if replace else '',
        'registerTags': ['neutral'],
    }


class TemporaryLexicon(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.bank = self.directory / 'bank'
        self.work = self.directory / 'work'
        self.bank.mkdir()
        self.addCleanup(patch.stopall)
        patch.object(enrich, 'BANK', self.bank).start()
        patch.object(enrich, 'WORK', self.work).start()
        self.forbid_real_cli = patch.object(enrich, 'call_cli', side_effect=AssertionError('No real model call in an offline test')).start()
        for name in enrich.BASE_FILES:
            enrich.atomic_json(self.bank / name, {'entries': []})

    def write_bank(self, entries, name='entries.json'):
        enrich.atomic_json(self.bank / name, {'entries': entries})

    def prepare(self, size=1):
        with contextlib.redirect_stdout(io.StringIO()):
            enrich.prepare(size)
        return enrich.read(self.work / 'input.json')

    def generate_fixture(self, index, inputs, *, corrections=None, blocked=None, replace=False):
        """Exercise real batching/binding using deterministic fake CLI responses."""
        calls = []
        corrections = corrections or {}

        def fake_cli(prompt, payload, schema, path, timeout):
            calls.append((path.name, copy.deepcopy(payload)))
            if path.name == 'draft.json':
                value = {'rows': [analysis(s, replace=replace) for s in payload]}
            elif path.name.startswith('review-'):
                proposed = payload['proposedRows']
                changed = []
                for row in proposed:
                    if path.name == 'review-1.json' and row['rowId'] in corrections:
                        changed.append({**row, **corrections[row['rowId']]})
                value = {'checkedRowIds': [r['rowId'] for r in proposed],
                         'corrections': changed, 'blocked': blocked or []}
            else:
                raise AssertionError('Unexpected repair/model call: ' + path.name)
            enrich.atomic_json(path, value)
            return value

        with patch.object(enrich, 'call_cli', side_effect=fake_cli):
            result = enrich.batch(index, inputs, 5)
        return result, calls

    def publish(self, partial=False):
        with contextlib.redirect_stdout(io.StringIO()):
            enrich.publish(partial)
        return enrich.read(self.bank / 'full-analysis.json')

    def fixture(self, count=1):
        self.write_bank([source_entry('snag', str(i)) for i in range(1, count + 1)])
        return self.prepare()


class PersistedRepairReplayTests(TemporaryLexicon):
    def seed_chain(self, reviewer=False):
        sources = self.fixture(3 if reviewer else 1)['rows']
        originals = [analysis(source) for source in sources]
        corrected = copy.deepcopy(originals)
        for row in corrected:
            row['usageNotes'][0] += ' Учитывайте конкретного адресата сообщения.'
        middle = copy.deepcopy(corrected)
        for row in middle:
            row['usageNotes'][0] += ' Это первая уточненная формулировка.'
        final = copy.deepcopy(middle)
        for row in final:
            row['usageNotes'][0] += ' Укажите причину возникшего препятствия.'
        expected = [middle[0], final[1], corrected[2]] if reviewer else final
        invalid_before = [corrected[0], corrected[1], middle[1]] if reviewer else [originals[0], middle[0]]
        validator = enrich.validate_rows

        def old_validator(rows, inputs):
            validator(rows, inputs)
            if any(row in invalid_before for row in rows):
                raise ValueError('Former validator required a different target spelling')
            return rows

        def cli(prompt, payload, schema, path, timeout):
            if path.name == 'draft.json':
                result = {'rows': originals}
            elif path.name == 'format-repair-1.json' and not reviewer:
                result = {'rows': middle}
            elif path.name == 'format-repair-2.json' and not reviewer:
                result = {'rows': final}
            elif path.name == 'review-1.json':
                result = {'checkedRowIds': [row['rowId'] for row in originals],
                          'corrections': corrected if reviewer else [], 'blocked': []}
            elif path.name == 'review-format-repair-1-1.json' and reviewer:
                self.assertEqual(payload['sources'], sources[:2])
                result = {'rows': middle[:2]}
            elif path.name == 'review-format-repair-1-2.json' and reviewer:
                self.assertEqual(payload['sources'], sources[1:2])
                result = {'rows': final[1:2]}
            elif path.name == 'review-2.json' and reviewer:
                self.assertEqual(payload['proposedRows'], expected)
                result = {'checkedRowIds': [row['rowId'] for row in originals], 'corrections': [], 'blocked': []}
            else:
                self.fail('Unexpected call: ' + path.name)
            enrich.atomic_json(path, result)
            return result

        with patch.object(enrich, 'call_cli', side_effect=cli), patch.object(enrich, 'validate_rows', side_effect=old_validator):
            enrich.batch(1, sources, 5)
        folder = self.work / 'batches/0001'
        before = {path.name: path.read_bytes() for path in folder.glob('*.json')}
        (folder / 'verified.json').unlink()
        return sources, folder, before, expected

    def test_resume_replays_entire_draft_chain_even_when_original_now_valid(self):
        sources, folder, before, expected = self.seed_chain()
        enrich.validate_rows(enrich.read(folder / 'draft.json')['rows'], sources)
        enrich.batch(1, sources, 5)
        self.forbid_real_cli.assert_not_called()
        self.assertEqual(enrich.read(folder / 'verified.json')['rows'], expected)
        self.assertEqual({path.name: path.read_bytes() for path in folder.glob('*.json')}, before)

    def test_resume_replays_exact_reviewer_subsets_and_requires_the_later_review(self):
        sources, folder, before, expected = self.seed_chain(reviewer=True)
        enrich.validate_rows(enrich.read(folder / 'review-1.json')['corrections'], sources)
        enrich.batch(1, sources, 5)
        self.forbid_real_cli.assert_not_called()
        receipt = enrich.read(folder / 'verified.json')
        self.assertEqual(receipt['rows'], expected)
        self.assertTrue(all(proof['file'] == 'review-2.json' for proof in receipt['accepted'].values()))
        self.assertEqual({path.name: path.read_bytes() for path in folder.glob('*.json')}, before)

    def test_started_request_without_output_resumes_the_exact_historical_payload(self):
        sources, folder, before, expected = self.seed_chain()
        path = folder / 'format-repair-1.json'
        response = enrich.read(path)
        saved = enrich.read(path.with_suffix('.request.json'))
        path.unlink()

        def cli(prompt, payload, schema, output, timeout):
            self.assertEqual(output, path)
            self.assertEqual(payload, saved['payload'])
            self.assertEqual(prompt, saved['prompt'])
            self.assertEqual(schema, saved['schema'])
            enrich.atomic_json(output, response)
            return response

        with patch.object(enrich, 'call_cli', side_effect=cli) as calls:
            enrich.batch(1, sources, 5)
        self.assertEqual(calls.call_count, 1)
        self.assertEqual(enrich.read(folder / 'verified.json')['rows'], expected)
        self.assertEqual({p.name: p.read_bytes() for p in folder.glob('*.json')}, before)

    def test_corrupt_binding_or_resigned_mismatched_source_and_parent_draft_are_rejected(self):
        sources, folder, before, _ = self.seed_chain()
        path = folder / 'format-repair-1.request.json'
        original = enrich.read(path)
        for kind in ['checksum', 'source', 'parent-draft', 'contract']:
            with self.subTest(kind=kind):
                request = copy.deepcopy(original)
                if kind == 'checksum':
                    request['payload']['validationError'] += ' changed without updating SHA'
                elif kind == 'source':
                    request['payload']['sources'][0]['en'] += ' Changed.'
                elif kind == 'parent-draft':
                    request['payload']['draft'][0]['meaningEn'] += ' Changed.'
                else:
                    request['prompt'] += '\nUse a different contract.'
                if kind != 'checksum':
                    request['sha256'] = enrich.value_sha({k: request[k] for k in ['policy', 'prompt', 'payload', 'schema']})
                enrich.atomic_json(path, request)
                with self.assertRaisesRegex(ValueError, 'Format repair|Changed format repair'):
                    enrich.batch(1, sources, 5)
                path.write_bytes(before[path.name])
        self.forbid_real_cli.assert_not_called()
        self.assertFalse((folder / 'verified.json').exists())

    def test_changed_repair_output_is_rejected_by_its_next_exact_bound_request(self):
        sources, folder, before, _ = self.seed_chain()
        for name in ['format-repair-1.json', 'format-repair-2.json']:
            with self.subTest(name=name):
                path = folder / name
                changed = enrich.read(path)
                changed['rows'][0]['meaningEn'] += ' Unexpected valid alteration.'
                enrich.atomic_json(path, changed)
                with self.assertRaisesRegex(ValueError, 'Changed (format repair|checkpoint)'):
                    enrich.batch(1, sources, 5)
                path.write_bytes(before[name])
        self.forbid_real_cli.assert_not_called()

    def test_reviewer_repair_rejects_wrong_subset_proposals_and_output_identities(self):
        sources, folder, before, _ = self.seed_chain(reviewer=True)
        binding = folder / 'review-format-repair-1-2.request.json'
        request = enrich.read(binding)
        request['payload']['draft'][0]['meaningEn'] += ' Not the preceding correction.'
        request['sha256'] = enrich.value_sha({k: request[k] for k in ['policy', 'prompt', 'payload', 'schema']})
        enrich.atomic_json(binding, request)
        with self.assertRaisesRegex(ValueError, 'Changed format repair source/proposal subset'):
            enrich.batch(1, sources, 5)
        binding.write_bytes(before[binding.name])
        path = folder / 'review-format-repair-1-1.json'
        changed = enrich.read(path)
        changed['rows'][1] = copy.deepcopy(changed['rows'][0])
        enrich.atomic_json(path, changed)
        with self.assertRaisesRegex(ValueError, 'Format repair changed correction identities'):
            enrich.batch(1, sources, 5)
        self.forbid_real_cli.assert_not_called()

    def test_orphaned_second_repair_is_not_silently_skipped(self):
        sources, folder, _, _ = self.seed_chain()
        (folder / 'format-repair-1.json').unlink()
        (folder / 'format-repair-1.request.json').unlink()
        with self.assertRaisesRegex(ValueError, 'Non-contiguous format repair checkpoint'):
            enrich.batch(1, sources, 5)
        self.forbid_real_cli.assert_not_called()


class SnapshotAndSourceTests(TemporaryLexicon):
    def test_invalid_review_correction_is_repaired_then_reviewed_again(self):
        sources = self.fixture()['rows']
        calls = []
        valid = analysis(sources[0])
        corrected = copy.deepcopy(valid)
        corrected['commonMistakes'][0]['why'] = 'Для исчисляемого существительного в единственном числе здесь требуется неопределенный артикль.'

        def cli(prompt, payload, schema, path, timeout):
            calls.append(path.name)
            if path.name == 'draft.json':
                result = {'rows': [valid]}
            elif path.name == 'review-1.json':
                invalid = copy.deepcopy(corrected)
                invalid['commonMistakes'][0]['why'] = ''
                result = {'checkedRowIds': [valid['rowId']], 'corrections': [invalid], 'blocked': []}
            elif path.name == 'review-format-repair-1-1.json':
                self.assertEqual(payload['sources'], sources)
                result = {'rows': [corrected]}
            elif path.name == 'review-2.json':
                self.assertEqual(payload['proposedRows'], [corrected])
                result = {'checkedRowIds': [valid['rowId']], 'corrections': [], 'blocked': []}
            else:
                self.fail('Unexpected call: ' + path.name)
            enrich.atomic_json(path, result)
            return result

        with patch.object(enrich, 'call_cli', side_effect=cli):
            enrich.batch(1, sources, 5)
        receipt = enrich.read(self.work / 'batches/0001/verified.json')
        self.assertEqual(receipt['rows'], [corrected])
        self.assertEqual(receipt['accepted'][valid['rowId']]['file'], 'review-2.json')
        self.assertEqual(calls, ['draft.json', 'review-1.json', 'review-format-repair-1-1.json', 'review-2.json'])

    def test_prepare_selects_every_active_context_in_all_three_documents(self):
        self.write_bank([source_entry('snag', 'base'), source_entry('old', 'archived', archived=True)])
        self.write_bank([source_entry('delay', 'extension')], 'coca-extension.json')
        self.write_bank([source_entry('problem', 'phrase')], 'american-phrases.json')
        original = {name: (self.bank / name).read_bytes() for name in enrich.BASE_FILES}
        snapshot = self.prepare(2)
        self.assertEqual(snapshot['targetRows'], 3)
        self.assertEqual(snapshot['targetEntries'], 4)
        self.assertEqual({row['file'] for row in snapshot['rows']}, set(enrich.BASE_FILES))
        self.assertNotIn('entry-archived:context-archived', {row['rowId'] for row in snapshot['rows']})
        self.assertTrue(all(row['ru'] and row['previousExplanation'] for row in snapshot['rows']))
        for row in snapshot['rows']:
            entries = enrich.read(self.bank / row['file'])['entries']
            entry = next(e for e in entries if e['id'] == row['entryId'])
            context = next(c for c in entry['contexts'] if c['id'] == row['contextId'])
            self.assertEqual(row['sourceContextSHA256'], enrich.value_sha(context))
        self.assertEqual(original, {name: (self.bank / name).read_bytes() for name in enrich.BASE_FILES})

    def test_prepare_refuses_to_overwrite_immutable_snapshot(self):
        self.fixture()
        original = (self.work / 'input.json').read_bytes()
        with self.assertRaisesRegex(ValueError, 'snapshot'):
            self.prepare()
        self.assertEqual((self.work / 'input.json').read_bytes(), original)

    def test_duplicate_context_identity_across_banks_is_rejected(self):
        entry = source_entry()
        self.write_bank([entry])
        self.write_bank([copy.deepcopy(entry)], 'coca-extension.json')
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            self.prepare()

    def test_source_context_hash_binds_translation_highlights_and_attribution(self):
        entry = source_entry()
        context = entry['contexts'][0]
        baseline = enrich.input_row(entry, context, 'entries.json')
        for change in [{'ru': 'Другой перевод.'}, {'source': {'sourceId': 'another'}}, {'targetSpans': []}]:
            with self.subTest(change=change):
                modified = {**context, **change}
                self.assertNotEqual(enrich.input_row(entry, modified, 'entries.json')['sourceContextSHA256'], baseline['sourceContextSHA256'])


class LearningRowTests(unittest.TestCase):
    def setUp(self):
        entry = source_entry()
        self.source = enrich.input_row(entry, entry['contexts'][0], 'entries.json')
        self.row = analysis(self.source)

    def test_keep_preserves_exact_source_and_does_not_modify_input(self):
        before = copy.deepcopy(self.source)
        self.assertEqual(enrich.validate_rows([self.row], [self.source]), [self.row])
        self.assertEqual(self.source, before)
        with self.assertRaisesRegex(ValueError, 'Keep'):
            enrich.validate_rows([{**self.row, 'en': self.row['en'].replace('new', 'old')}], [self.source])
        with self.assertRaisesRegex(ValueError, 'Keep'):
            enrich.validate_rows([{**self.row, 'replacementReason': 'Источник не изменялся.'}], [self.source])

    def test_replace_requires_new_english_reason_and_whole_target(self):
        good = analysis(self.source, replace=True)
        self.assertEqual(enrich.validate_rows([good], [self.source]), [good])
        for changes in [{'replacementReason': ''}, {'en': self.source['en']},
                        {'en': 'The snagged fabric prevented us from finishing the work.'}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                enrich.validate_rows([{**good, **changes}], [self.source])

    def test_display_abbreviation_and_utf16_offsets_survive_replacement(self):
        source = {**self.source, 'word': 'am', 'displayHeadword': 'a.m.'}
        row = {**analysis(source, replace=True), 'en': '😀 We meet at 8 a.m. before the first train leaves.'}
        spans = enrich.spans_for(row, source)
        self.assertEqual(spans, [{'start': 16, 'end': 20, 'text': 'a.m.'}])
        self.assertEqual(source['en'], self.source['en'])

    def test_unicode_substring_cannot_satisfy_replacement_target(self):
        source = {**self.source, 'word': 'mi', 'displayHeadword': 'mi'}
        row = {**analysis(source, replace=True), 'en': 'Northern Sámi is spoken in several northern European countries.'}
        with self.assertRaisesRegex(ValueError, 'whole target'):
            enrich.spans_for(row, source)

    def test_missing_russian_or_learning_components_are_not_accepted(self):
        for changes in [{'meaningRu': 'difficulty'}, {'usageNotes': []}, {'collocations': []},
                        {'commonMistakes': []}, {'explanation': 'Коротко.'},
                        {'commonMistakes': [{'wrong': 'the same', 'correct': 'the same', 'why': 'Достаточно длинное пояснение предполагаемой ошибки.'}]}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                enrich.validate_rows([{**self.row, **changes}], [self.source])

    def test_task_must_name_target_not_a_substring_of_another_word(self):
        source = {**self.source, 'word': 'the', 'displayHeadword': 'the'}
        row = {**analysis(source), 'productionTask': 'Напишите коллеге два предложения о выборе времени встречи. Используйте whether и задайте вопрос.'}
        with self.assertRaisesRegex(ValueError, 'target'):
            enrich.validate_rows([row], [source])

    def test_task_can_name_exact_highlighted_form_in_a_retained_context(self):
        text = 'That comment is degrading to the other participants.'
        source = {**self.source, 'word': 'degrade', 'displayHeadword': 'degrade',
                  'en': text, 'targetSpans': enrich.full_target_spans(text, 'degrading')}
        row = {**analysis(source), 'pos': 'adjective', 'productionTask':
               'Напишите участнику чата два предложения с просьбой изменить тон; используйте форму degrading.'}
        self.assertEqual(enrich.validate_rows([row], [source]), [row])
        for target in ['degradation', 'degraded', 'non-degrading', 'degradingly']:
            with self.subTest(target=target), self.assertRaisesRegex(ValueError, 'omits target'):
                enrich.validate_rows([{**row, 'productionTask':
                    'Напишите участнику чата два предложения с просьбой изменить тон; используйте ' + target + '.'}], [source])

    def test_task_does_not_borrow_stale_or_inexact_source_highlights(self):
        text = 'That comment is degrading to the other participants.'
        source = {**self.source, 'word': 'degrade', 'displayHeadword': 'degrade',
                  'en': text, 'targetSpans': enrich.full_target_spans(text, 'degrading')}
        task = 'Напишите участнику чата два предложения с просьбой изменить тон; используйте форму degrading.'
        row = {**analysis(source), 'pos': 'adjective', 'productionTask': task}
        for spans in [[{**source['targetSpans'][0], 'start': 0}],
                      [{'start': 16, 'end': 24, 'text': 'degradin'}],
                      [{'start': 0, 'end': 9, 'text': 'degrading'}]]:
            with self.subTest(spans=spans), self.assertRaisesRegex(ValueError, 'omits target'):
                enrich.validate_rows([row], [{**source, 'targetSpans': spans}])
        replacement = {**analysis(source, replace=True), 'productionTask': task}
        with self.assertRaisesRegex(ValueError, 'omits target'):
            enrich.validate_rows([replacement], [source])

    def test_complete_phrase_replacement_preserves_utf16_span(self):
        source = {**self.source, 'word': 'figure out', 'displayHeadword': 'figure out'}
        row = {**analysis(source, replace=True),
               'en': '😀 We need to figure out why the payment failed before trying again.'}
        spans = enrich.spans_for(row, source)
        self.assertEqual(spans, [{'start': 14, 'end': 24, 'text': 'figure out'}])
        enrich.validate_rows([row], [source])

    def test_phrase_target_cannot_match_a_partial_word_or_hyphenated_compound(self):
        source = {**self.source, 'word': 'figure out', 'displayHeadword': 'figure out'}
        for text in ['The figure outlier needs another explanation.',
                     'The pre-figure out method was described in the note.',
                     'The phrase figure out-like appears in this draft.']:
            row = {**analysis(source, replace=True), 'en': text}
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, 'whole target'):
                enrich.spans_for(row, source)
        row = {**analysis(source), 'productionTask':
               'Напишите коллеге два предложения о результате проверки. Используйте figure outlier в сообщении.'}
        with self.assertRaisesRegex(ValueError, 'target'):
            enrich.validate_rows([row], [source])


class IndependentReviewTests(TemporaryLexicon):
    def test_changed_correction_gets_another_review_and_unchanged_rows_keep_their_acceptance(self):
        snapshot = self.fixture(2)
        inputs = snapshot['rows']
        changed_id = inputs[0]['rowId']
        result, calls = self.generate_fixture(1, inputs, corrections={changed_id: {'meaningRu': 'неожиданное препятствие'}})
        self.assertEqual(result['status'], 'verified')
        receipt = enrich.read(self.work / 'batches/0001/verified.json')
        self.assertEqual(receipt['accepted'][changed_id]['file'], 'review-2.json')
        self.assertEqual(receipt['accepted'][inputs[1]['rowId']]['file'], 'review-1.json')
        second = next(payload for name, payload in calls if name == 'review-2.json')
        self.assertEqual([row['rowId'] for row in second['sources']], [changed_id])
        self.assertEqual(second['proposedRows'][0]['meaningRu'], 'неожиданное препятствие')
        enrich.verify_receipt(receipt, inputs, self.work / 'batches/0001')

    def test_resume_uses_verified_checkpoint_without_model_calls(self):
        inputs = self.fixture()['rows']
        self.generate_fixture(1, inputs)
        result = enrich.batch(1, inputs, 5)
        self.assertEqual(result['status'], 'resumed')
        self.forbid_real_cli.assert_not_called()
        changed = [{**inputs[0], 'previousExplanation': 'Входные данные изменились.'}]
        with self.assertRaisesRegex(ValueError, 'Stale'):
            enrich.batch(1, changed, 5)

    def test_blocked_semantic_review_does_not_create_verified_checkpoint(self):
        inputs = self.fixture()['rows']
        with self.assertRaisesRegex(ValueError, 'blocked'):
            self.generate_fixture(1, inputs, blocked=[{'rowId': inputs[0]['rowId'], 'reason': 'Нет надежного смысла.'}])
        self.assertFalse((self.work / 'batches/0001/verified.json').exists())

    def test_cached_call_rejects_unbound_or_changed_request(self):
        path = self.work / 'request-result.json'
        enrich.atomic_json(path, {'rows': []})
        with self.assertRaisesRegex(ValueError, 'Unbound'):
            enrich.cached_call(path, 'prompt', {'x': 1}, {}, 5)
        path.unlink()
        def fake(prompt, payload, schema, output, timeout):
            enrich.atomic_json(output, {'rows': []})
            return {'rows': []}
        with patch.object(enrich, 'call_cli', side_effect=fake) as cli:
            enrich.cached_call(path, 'prompt', {'x': 1}, {}, 5)
            enrich.cached_call(path, 'prompt', {'x': 1}, {}, 5)
            self.assertEqual(cli.call_count, 1)
        for prompt, payload, schema in [('different', {'x': 1}, {}), ('prompt', {'x': 2}, {}), ('prompt', {'x': 1}, {'type': 'array'})]:
            with self.subTest(prompt=prompt, payload=payload, schema=schema), self.assertRaisesRegex(ValueError, 'Changed checkpoint'):
                enrich.cached_call(path, prompt, payload, schema, 5)

    def test_tampered_review_file_is_rejected(self):
        inputs = self.fixture()['rows']
        self.generate_fixture(1, inputs)
        folder = self.work / 'batches/0001'
        receipt = enrich.read(folder / 'verified.json')
        enrich.atomic_json(folder / 'review-1.json', {'checkedRowIds': [], 'corrections': [], 'blocked': []})
        with self.assertRaises(ValueError):
            enrich.verify_receipt(receipt, inputs, folder)

    def test_rehashing_an_unreviewed_output_cannot_fake_semantic_acceptance(self):
        inputs = self.fixture()['rows']
        self.generate_fixture(1, inputs)
        folder = self.work / 'batches/0001'
        receipt = enrich.read(folder / 'verified.json')
        row = receipt['rows'][0]
        row['meaningRu'] = 'совершенно другое значение'
        receipt['rowsSHA256'] = enrich.value_sha(receipt['rows'])
        receipt['accepted'][row['rowId']]['outputSHA256'] = enrich.value_sha(row)
        with self.assertRaises(ValueError):
            enrich.verify_receipt(receipt, inputs, folder)

    def test_a_review_that_proposed_a_correction_is_not_acceptance_of_that_correction(self):
        inputs = self.fixture()['rows']
        self.generate_fixture(1, inputs, corrections={inputs[0]['rowId']: {'meaningRu': 'неожиданное препятствие'}})
        folder = self.work / 'batches/0001'
        receipt = enrich.read(folder / 'verified.json')
        row = receipt['rows'][0]
        receipt['accepted'][row['rowId']] = {'outputSHA256': enrich.value_sha(row), **receipt['reviews'][0]}
        with self.assertRaises(ValueError):
            enrich.verify_receipt(receipt, inputs, folder)


class PublicationTests(TemporaryLexicon):
    def test_partial_then_complete_publication_preserves_banks_sources_and_old_shards(self):
        snapshot = self.fixture(2)
        original = {name: (self.bank / name).read_bytes() for name in enrich.BASE_FILES}
        self.generate_fixture(1, snapshot['rows'][:1], replace=True)
        partial = self.publish(partial=True)
        self.assertEqual((partial['rows'], partial['targetRows'], partial['complete']), (1, 2, False))
        shard = self.bank / partial['shards'][0]['name']
        old_shard = shard.read_bytes()
        row = enrich.read(shard)['rows'][0]
        self.assertEqual(row['entryId'], snapshot['rows'][0]['entryId'])
        self.assertEqual(row['contextId'], snapshot['rows'][0]['contextId'])
        self.assertEqual(row['sourceContextSHA256'], snapshot['rows'][0]['sourceContextSHA256'])
        self.assertNotEqual(row['en'], snapshot['rows'][0]['en'])
        self.assertEqual(row['action'], 'replace')
        self.generate_fixture(2, snapshot['rows'][1:])
        complete = self.publish()
        self.assertEqual((complete['rows'], complete['complete']), (2, True))
        self.assertEqual(shard.read_bytes(), old_shard)
        self.assertEqual(original, {name: (self.bank / name).read_bytes() for name in enrich.BASE_FILES})

    def test_changed_base_bank_stops_publication_without_touching_existing_manifest(self):
        snapshot = self.fixture()
        self.generate_fixture(1, snapshot['rows'])
        self.publish()
        before = (self.bank / 'full-analysis.json').read_bytes()
        with (self.bank / 'entries.json').open('ab') as handle:
            handle.write(b'\n')
        with self.assertRaisesRegex(ValueError, 'bank changed'):
            self.publish()
        self.assertEqual((self.bank / 'full-analysis.json').read_bytes(), before)

    def test_unreviewed_batch_cannot_make_complete_manifest(self):
        snapshot = self.fixture(2)
        self.generate_fixture(1, snapshot['rows'][:1])
        with self.assertRaises((ValueError, FileNotFoundError)):
            self.publish()
        self.assertFalse((self.bank / 'full-analysis.json').exists())

    def test_truncated_input_snapshot_cannot_claim_all_active_contexts_complete(self):
        snapshot = self.fixture(2)
        snapshot['rows'] = snapshot['rows'][:1]
        snapshot['targetRows'] = 1
        enrich.atomic_json(self.work / 'input.json', snapshot)
        self.generate_fixture(1, snapshot['rows'])
        with self.assertRaises(ValueError):
            self.publish()
        self.assertFalse((self.bank / 'full-analysis.json').exists())

    def test_rebound_source_metadata_in_snapshot_cannot_be_published(self):
        snapshot = self.fixture()
        snapshot['rows'][0]['sourceContextSHA256'] = '0' * 64
        enrich.atomic_json(self.work / 'input.json', snapshot)
        self.generate_fixture(1, snapshot['rows'])
        with self.assertRaises(ValueError):
            self.publish()
        self.assertFalse((self.bank / 'full-analysis.json').exists())

    def test_partial_publication_cannot_drop_previously_published_rows(self):
        snapshot = self.fixture(2)
        self.generate_fixture(1, snapshot['rows'][:1])
        self.generate_fixture(2, snapshot['rows'][1:])
        self.publish()
        original_manifest = (self.bank / 'full-analysis.json').read_bytes()
        (self.work / 'batches/0002/verified.json').unlink()
        with self.assertRaises(ValueError):
            self.publish(partial=True)
        self.assertEqual((self.bank / 'full-analysis.json').read_bytes(), original_manifest)


if __name__ == '__main__':
    unittest.main()

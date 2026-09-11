"""Safety of the editorial overlay: learner IDs and source attribution survive."""
import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from build_context_lexicon import validate_entries, atomic_json, file_sha
import complete_context_lexicon as completion
from complete_context_lexicon import apply_overlay, apply_selection_repairs, american_definition, fingerprint, SOURCE_ID


class CompletionOverlayTests(unittest.TestCase):
    def fixture(self):
        context = {'id': 'context-stable', 'en': 'The door locked itself.', 'ru': None,
            'targetSpans': [{'start': 16, 'end': 22, 'text': 'itself'}],
            'senseId': None, 'quality': 'imported-context',
            'source': {'sourceId': 'tatoeba-eng', 'license': 'CC-BY-2.0-FR', 'sentenceId': 1}}
        entry = {'id': 'entry-stable', 'word': 'itself', 'cefr': None, 'senses': [],
                 'contexts': [context], 'quality': {'status': 'imported-context', 'reviewedContextCount': 0}}
        overlay = {'source': {'id': SOURCE_ID, 'author': 'Project with AI assistance',
            'license': 'original-project-content', 'checkedAt': '2026-09-10'},
            'entries': [{'rowId': 'entry-stable:context-stable', 'entryId': entry['id'],
                'contextId': context['id'], 'baseSHA256': fingerprint(entry, context),
                'originalRu': None, 'originalSenseId': None, 'ru': 'Дверь сама заперлась.',
                'pos': 'pronoun', 'meaningEn': 'without someone else causing the action',
                'meaningRu': 'сама, без постороннего воздействия',
                'explanation': 'Дверь заперлась сама: никто не запирал её намеренно.',
                'registerTags': [], 'sourceIssues': [], 'reviewPasses': 2}]}
        return {'spanEncoding': 'utf-16', 'entries': [entry]}, overlay

    def test_stable_ids_sources_and_original_document(self):
        original, overlay = self.fixture()
        before = copy.deepcopy(original)
        result = apply_overlay(original, overlay)
        self.assertEqual(original, before)
        entry = result['entries'][0]
        context = entry['contexts'][0]
        self.assertEqual(entry['id'], 'entry-stable')
        self.assertEqual(context['id'], 'context-stable')
        self.assertEqual(context['en'], original['entries'][0]['contexts'][0]['en'])
        self.assertEqual(context['source'], original['entries'][0]['contexts'][0]['source'])
        self.assertEqual(context['translationSource']['license'], 'CC-BY-2.0-FR')
        self.assertEqual(entry['quality']['reviewedContextCount'], 0)
        self.assertEqual(entry['quality']['status'], 'ai-context-reviewed')
        validate_entries(result, [{'id': 'tatoeba-eng'}, {'id': SOURCE_ID}])
        self.assertEqual(apply_overlay(result, overlay), result)

    def test_source_change_requires_fresh_review(self):
        original, overlay = self.fixture()
        original['entries'][0]['contexts'][0]['en'] = 'The door did not lock itself.'
        with self.assertRaisesRegex(ValueError, 'Changed English source'):
            apply_overlay(original, overlay)

    def test_translation_change_is_not_overwritten(self):
        original, overlay = self.fixture()
        original['entries'][0]['contexts'][0]['ru'] = 'Пользовательский исправленный перевод.'
        with self.assertRaisesRegex(ValueError, 'Changed Russian source'):
            apply_overlay(original, overlay)

    def test_quality_label_alone_cannot_authorize_ai_alignment(self):
        original, overlay = self.fixture()
        result = apply_overlay(original, overlay)
        del result['entries'][0]['contexts'][0]['completionReview']
        with self.assertRaisesRegex(ValueError, 'requires a selected editorial sense and review receipt'):
            validate_entries(result, [{'id': 'tatoeba-eng'}, {'id': SOURCE_ID}])

    def test_archived_translation_and_sense_do_not_count_as_study_alignment(self):
        original, overlay = self.fixture()
        result = apply_overlay(original, overlay)
        entry = result['entries'][0]
        entry['contexts'][0]['excludedFromStudy'] = True
        active = copy.deepcopy(original['entries'][0]['contexts'][0])
        active['id'] = 'new-active-context'
        active['ru'] = 'Дверь сама заперлась.'
        entry['contexts'].append(active)
        counts = completion.inventory(result)
        self.assertEqual(counts['entriesWithTranslatedSelectedMeaning'], 0)
        self.assertEqual(counts['studyContextsWithoutSelectedMeaning'], 1)
        self.assertEqual(counts['entriesWithoutStudyContext'], 0)

    def test_unicode_substring_is_not_a_study_word(self):
        original, overlay = self.fixture()
        entry = original['entries'][0]
        entry['word'] = 'mi'
        context = entry['contexts'][0]
        context.update({'en': 'Northern Sámi is a language.',
            'targetSpans': [{'start': 11, 'end': 13, 'text': 'mi'}]})
        original['unicodeTokenSelectionValidated'] = True
        with self.assertRaisesRegex(ValueError, 'complete Unicode token'):
            validate_entries(original, [{'id': 'tatoeba-eng'}])
        replacement = copy.deepcopy(context)
        replacement.update({'id': 'valid-context', 'en': 'Sing mi after re.',
            'targetSpans': [{'start': 5, 'end': 7, 'text': 'mi'}]})
        repairs = {'source': {'id': 'selection-review'}, 'exclusions': [{
            'entryId': entry['id'], 'contextId': context['id'],
            'baseSHA256': fingerprint(entry, context), 'reason': 'Fragment inside a different Unicode word.'}],
            'additionalContexts': [{'entryId': entry['id'], 'context': replacement}]}
        repaired = apply_selection_repairs(original, repairs)
        self.assertEqual([c['id'] for c in repaired['entries'][0]['contexts']], ['valid-context', 'context-stable'])
        self.assertTrue(repaired['entries'][0]['contexts'][1]['excludedFromStudy'])
        validate_entries(repaired, [{'id': 'tatoeba-eng'}, {'id': 'selection-review'}])

    def test_american_spelling_preserves_semantic_and_named_forms(self):
        self.assertEqual(american_definition('A person who practises; a length in metres.'), 'A person who practices; a length in meters.')
        self.assertEqual(american_definition('Several analyses by the Labour Party.'), 'Several analyses by the Labour Party.')
        self.assertEqual(american_definition('A spelling variant of colour.'), 'A spelling variant of colour.')

    def test_unchanged_rows_reuse_exact_receipts_while_new_contexts_are_reviewed(self):
        inputs = [{'rowId': 'old', 'en': 'Old accepted context.'}, {'rowId': 'new', 'en': 'New replacement context.'}]
        template = {'ru': 'Полный русский перевод.', 'pos': 'noun', 'meaningEn': 'a useful example',
            'meaningRu': 'пример', 'explanation': 'Пояснение значения в конкретном контексте.', 'registerTags': [], 'sourceIssues': []}
        old, new = [{**template, 'rowId': key} for key in ['old', 'new']]
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / 'batches/001'
            archived = folder / 'verified-before-repair-2.json'
            atomic_json(archived, {'rows': [old], 'reviewPasses': 3})
            atomic_json(folder / 'draft.json', {'rows': [old, new], 'inputRevision': 3,
                'inheritedReviews': {'old': {'inputSHA256': completion.value_sha(inputs[0]),
                    'outputSHA256': completion.value_sha(old), 'receiptFile': archived.name,
                    'receiptSHA256': file_sha(archived), 'reviewPasses': 3}}})
            calls = []
            def review(prompt, payload, schema, diagnostic, timeout):
                calls.append(payload['sourceRows'])
                return {'checkedRowIds': ['new'], 'corrections': [], 'blocked': []}
            with patch.object(completion, 'WORK', Path(tmp)), patch.object(completion, 'call_cli', review):
                completion.batch(1, inputs, 30)
            self.assertEqual(calls, [[inputs[1]]])
            result = completion.read(folder / 'verified.json')
            self.assertEqual(result['rowReviewPasses'], {'old': 3, 'new': 1})

    def test_partial_acceptance_does_not_certify_blocked_or_unreviewed_corrections(self):
        from repair_failed_lexicon_batches import reuse_partial_reviews
        inputs = {key: {'rowId': key, 'en': key} for key in ['kept', 'corrected', 'blocked']}
        draft = {'rows': [{'rowId': key, 'meaningEn': 'draft'} for key in inputs]}
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            atomic_json(folder / 'review-1.json', {'checkedRowIds': list(inputs),
                'corrections': [{'rowId': 'corrected', 'meaningEn': 'fixed'}],
                'blocked': [{'rowId': 'blocked', 'reason': 'Impossible original use'}]})
            receipts = reuse_partial_reviews(folder, draft, inputs, {'blocked': {}}, 2)
            self.assertEqual(set(receipts), {'kept'})
            self.assertEqual(next(row for row in draft['rows'] if row['rowId'] == 'corrected')['meaningEn'], 'fixed')
            self.assertEqual(receipts['kept']['outputSHA256'], completion.value_sha({'rowId': 'kept', 'meaningEn': 'draft'}))

    def test_precise_short_definition_is_allowed_without_skipping_semantic_review(self):
        inputs = [{'rowId': 'grub', 'en': 'This restaurant serves some good-tasting grub.'}]
        row = {'rowId': 'grub', 'ru': 'В этом ресторане подают вкусную еду.', 'pos': 'noun',
               'meaningEn': 'food', 'meaningRu': 'еда', 'explanation': 'В ресторане подают еду; grub — разговорное название пищи.',
               'registerTags': ['informal'], 'sourceIssues': []}
        self.assertEqual(completion.validate_rows([row], inputs), [row])
        with self.assertRaisesRegex(ValueError, 'missing meaningEn'):
            completion.validate_rows([{**row, 'meaningEn': ''}], inputs)

    def test_second_partial_repair_retains_earlier_accepted_receipts(self):
        from repair_failed_lexicon_batches import reuse_partial_reviews
        inputs = {key: {'rowId': key, 'en': key} for key in ['earlier', 'newly_accepted', 'replace']}
        old_receipt = {'inputSHA256': 'unchanged-input', 'outputSHA256': 'unchanged-output',
                       'receiptFile': 'earlier.json', 'receiptSHA256': 'old-receipt', 'reviewPasses': 2}
        draft = {'inputRevision': 3, 'rows': [{'rowId': key, 'meaningEn': 'draft'} for key in inputs],
                 'inheritedReviews': {'earlier': old_receipt, 'replace': old_receipt}}
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            atomic_json(folder / 'review-r3-1.json', {'checkedRowIds': ['newly_accepted', 'replace'],
                'corrections': [], 'blocked': [{'rowId': 'replace', 'reason': 'Needs a new example'}]})
            receipts = reuse_partial_reviews(folder, draft, inputs, {'replace': {}}, 3)
            self.assertEqual(set(receipts), {'earlier', 'newly_accepted'})
            self.assertEqual(receipts['earlier'], old_receipt)


if __name__ == '__main__':
    unittest.main()

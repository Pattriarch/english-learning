import copy
from unittest.mock import patch

import amend_lexicon_analysis as amend
import enrich_lexicon as full
from test_enrich_lexicon import TemporaryLexicon


class EditorialAmendmentTests(TemporaryLexicon):
    def prepared(self):
        snapshot = self.fixture()
        self.generate_fixture(1, snapshot['rows'])
        folder = self.work / 'batches/0001'
        before = full.read(folder / 'verified.json')
        row = before['rows'][0]
        queue = [{'rowId': row['rowId'], 'beforeSHA256': full.value_sha(row),
                  'changes': {'meaningRu': 'препятствие в ходе работы'},
                  'reason': 'Уточнить значение конкретного употребления.'}]
        return snapshot, folder, before, queue

    def accepting(self, prompt, payload, schema, path, timeout):
        self.assertEqual(prompt, full.REVIEW_PROMPT)
        value = {'checkedRowIds': [row['rowId'] for row in payload['proposedRows']],
                 'corrections': [], 'blocked': []}
        full.atomic_json(path, value)
        return value

    def test_amendment_binds_actual_review_and_retains_original_receipt(self):
        snapshot, folder, before, queue = self.prepared()
        old_bytes = (folder / 'verified.json').read_bytes()
        with patch.object(full, 'call_cli', side_effect=self.accepting):
            amend.amend_batch(1, snapshot['rows'], queue, 5, self.work)
        after = full.read(folder / 'verified.json')
        self.assertEqual(after['rows'][0]['meaningRu'], queue[0]['changes']['meaningRu'])
        self.assertEqual((folder / after['amendments'][0]['previousReceipt']).read_bytes(), old_bytes)
        self.assertEqual(after['rows'][0]['en'], before['rows'][0]['en'])
        self.assertTrue(after['accepted'][queue[0]['rowId']]['file'].startswith('amendment-0001-review-'))
        full.verify_receipt(after, snapshot['rows'], folder)
        self.assertTrue(self.publish()['complete'])
        # Same queue resumes without repeating the call or losing its history.
        result = amend.amend_batch(1, snapshot['rows'], queue, 5, self.work)
        self.assertEqual(result['status'], 'resumed')
        self.assertEqual(len(full.read(folder / 'verified.json')['amendments']), 1)

    def test_changed_example_and_stale_guidance_cannot_be_amended(self):
        snapshot, folder, before, queue = self.prepared()
        for patch_value in [{'en': 'A different example.'}, {'rowId': 'another-row'}, {}]:
            invalid = copy.deepcopy(queue)
            invalid[0]['changes'] = patch_value
            with self.assertRaisesRegex(ValueError, 'Amendment may update guidance'):
                amend.amend_batch(1, snapshot['rows'], invalid, 5, self.work)
        queue[0]['beforeSHA256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'different accepted row'):
            amend.amend_batch(1, snapshot['rows'], queue, 5, self.work)
        self.assertEqual(full.read(folder / 'verified.json'), before)

    def test_corrected_review_is_reviewed_again(self):
        snapshot, folder, before, queue = self.prepared()
        calls = []
        def reviewer(prompt, payload, schema, path, timeout):
            calls.append(path.name)
            proposal = payload['proposedRows'][0]
            correction = {**proposal, 'meaningRu': 'неожиданное препятствие'}
            value = {'checkedRowIds': [proposal['rowId']], 'blocked': [],
                     'corrections': [correction] if len(calls) == 1 else []}
            full.atomic_json(path, value)
            return value
        with patch.object(full, 'call_cli', side_effect=reviewer):
            amend.amend_batch(1, snapshot['rows'], queue, 5, self.work)
        after = full.read(folder / 'verified.json')
        self.assertEqual(len(calls), 2)
        self.assertEqual(after['rows'][0]['meaningRu'], 'неожиданное препятствие')
        full.verify_receipt(after, snapshot['rows'], folder)

    def test_blocked_review_does_not_change_published_receipt(self):
        snapshot, folder, before, queue = self.prepared()
        def reviewer(prompt, payload, schema, path, timeout):
            value = {'checkedRowIds': [queue[0]['rowId']], 'corrections': [],
                     'blocked': [{'rowId': queue[0]['rowId'], 'reason': 'Needs source evidence'}]}
            full.atomic_json(path, value)
            return value
        with patch.object(full, 'call_cli', side_effect=reviewer):
            with self.assertRaisesRegex(ValueError, 'blocked amendment'):
                amend.amend_batch(1, snapshot['rows'], queue, 5, self.work)
        self.assertEqual(full.read(folder / 'verified.json'), before)

    def test_exact_old_contract_can_resume_without_rewriting_its_binding(self):
        path = self.work / 'old-review.json'
        payload = {'sources': [], 'proposedRows': []}
        request = {'policy': full.POLICY, 'prompt': full.LEGACY_REVIEW_PROMPT,
                   'schema': full.LEGACY_REVIEW_SCHEMA, 'payload': payload}
        full.atomic_json(path.with_suffix('.request.json'), {'sha256': full.value_sha(request), **request})
        full.atomic_json(path, {'checkedRowIds': [], 'corrections': [], 'blocked': []})
        before = path.with_suffix('.request.json').read_bytes()
        full.cached_call(path, full.REVIEW_PROMPT, payload, full.REVIEW_SCHEMA, 5)
        self.assertEqual(path.with_suffix('.request.json').read_bytes(), before)
        with self.assertRaisesRegex(ValueError, 'Changed checkpoint'):
            full.cached_call(path, full.REVIEW_PROMPT, {'sources':['changed']}, full.REVIEW_SCHEMA, 5)

    def test_pos_expansion_does_not_mutate_historical_contract(self):
        self.assertNotIn('infinitive-marker', full.LEGACY_REVIEW_SCHEMA['properties']['corrections']['items']['properties']['pos']['enum'])
        self.assertIn('infinitive-marker', full.REVIEW_SCHEMA['properties']['corrections']['items']['properties']['pos']['enum'])
        changed = copy.deepcopy(full.LEGACY_REVIEW_SCHEMA)
        changed['properties']['checkedRowIds'] = {'type':'string'}
        self.assertFalse(full.compatible_contract(full.LEGACY_REVIEW_PROMPT, changed, full.REVIEW_PROMPT, full.REVIEW_SCHEMA))

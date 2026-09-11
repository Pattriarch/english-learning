import copy
from unittest.mock import patch

import amend_lexicon_analysis as amend
import enrich_lexicon as full
import replace_lexicon_examples as replace
from test_enrich_lexicon import TemporaryLexicon, analysis


class ExplicitExampleReplacementTests(TemporaryLexicon):
    def prepared(self, *, original_replace=False):
        snapshot = self.fixture()
        self.generate_fixture(1, snapshot['rows'], replace=original_replace)
        folder = self.work / 'batches/0001'
        current = full.read(folder / 'verified.json')['rows'][0]
        proposal = analysis(snapshot['rows'][0], replace=True)
        proposal['en'] = 'A snag delayed our launch, so we told the client about the revised schedule.'
        return snapshot, folder, self.queue(snapshot['rows'][0], current, proposal)

    def queue(self, source, current, proposal=None):
        change = {'rowId': source['rowId'], 'beforeSHA256': full.value_sha(current),
                  'sourceRowSHA256': full.value_sha(source),
                  'sourceContextSHA256': source['sourceContextSHA256'],
                  'reason': 'Заменить неподходящий учебный пример с сохранением точного источника и истории.'}
        if proposal is None:
            change['brief'] = 'Teach the same common noun using an original workplace situation, with complete Russian learning guidance.'
        else:
            change['replacement'] = proposal
        return [change]

    def accepting(self, prompt, payload, schema, path, timeout):
        self.assertEqual(full.REVIEW_MODEL, replace.REVIEW_MODEL)
        self.assertEqual(prompt, full.REVIEW_PROMPT)
        self.assertEqual(payload['explicitExampleReplacement']['kind'], replace.KIND)
        value = {'checkedRowIds': [row['rowId'] for row in payload['proposedRows']],
                 'corrections': [], 'blocked': []}
        full.atomic_json(path, value)
        return value

    def run_replacement(self, snapshot, queue, reviewer=None):
        with patch.object(full, 'call_cli', side_effect=reviewer or self.accepting):
            return replace.replace_batch(1, snapshot['rows'], queue, 5, self.work, kind=replace.KIND)

    def published(self):
        manifest = self.publish()
        return full.read(self.bank / manifest['shards'][0]['name'])['rows'][0]

    def test_replacing_existing_replacement_retains_exact_receipt_and_context_revision(self):
        snapshot, folder, queue = self.prepared(original_replace=True)
        old_bytes = (folder / 'verified.json').read_bytes()
        old_receipt = full.read(folder / 'verified.json')
        base_bytes = (self.bank / 'entries.json').read_bytes()
        self.run_replacement(snapshot, queue)
        after = full.read(folder / 'verified.json')
        row_id = queue[0]['rowId']
        self.assertEqual(after['exampleRevisions'], {row_id: 2})
        old = after['exampleHistory'][row_id][0]
        self.assertEqual((folder / old['receiptFile']).read_bytes(), old_bytes)
        self.assertEqual(old['rowSHA256'], full.value_sha(old_receipt['rows'][0]))
        published = self.published()
        self.assertEqual(published['exampleRevision'], 2)
        self.assertEqual(published['contextId'], snapshot['rows'][0]['contextId'])
        self.assertEqual(published['previousAnalyses'][0]['exampleRevision'], 1)
        prior_row = published['previousAnalyses'][0]['row']
        self.assertEqual(prior_row['en'], old_receipt['rows'][0]['en'])
        self.assertEqual(prior_row['action'], 'replace')
        self.assertEqual(prior_row['review']['semanticReviewSHA256'], old_receipt['accepted'][row_id]['sha256'])
        self.assertEqual(prior_row['targetSpans'], full.spans_for(old_receipt['rows'][0], snapshot['rows'][0]))
        self.assertNotIn('previousAnalyses', prior_row)
        self.assertEqual((self.bank / 'entries.json').read_bytes(), base_bytes)
        full.verify_receipt(after, snapshot['rows'], folder)

    def test_keep_then_two_replacements_publish_chronological_original_analyses(self):
        snapshot, folder, queue = self.prepared()
        initial = full.read(folder / 'verified.json')['rows'][0]
        self.run_replacement(snapshot, queue)
        second = full.read(folder / 'verified.json')['rows'][0]
        third = {**copy.deepcopy(second), 'en': 'We found a snag in the contract before the supplier signed it.'}
        self.run_replacement(snapshot, self.queue(snapshot['rows'][0], second, third))
        published = self.published()
        self.assertEqual(published['exampleRevision'], 3)
        self.assertEqual([x['exampleRevision'] for x in published['previousAnalyses']], [1, 2])
        self.assertEqual([x['row']['en'] for x in published['previousAnalyses']], [initial['en'], second['en']])
        self.assertEqual([x['row']['action'] for x in published['previousAnalyses']], ['keep', 'replace'])

    def test_cached_resume_does_not_call_model_or_rewrite_history(self):
        snapshot, folder, queue = self.prepared()
        self.run_replacement(snapshot, queue)
        old = {path.name: path.read_bytes() for path in folder.glob('*.json')}
        result = replace.replace_batch(1, snapshot['rows'], queue, 5, self.work, kind=replace.KIND)
        self.assertEqual(result['status'], 'resumed')
        self.assertEqual({path.name: path.read_bytes() for path in folder.glob('*.json')}, old)

    def test_blocked_or_malformed_review_does_not_change_receipt_or_publication(self):
        for malformed in (False, True):
            with self.subTest(malformed=malformed):
                # Each attempted review gets a distinct offline fixture folder.
                snapshot, folder, queue = self.prepared()
                initial = (folder / 'verified.json').read_bytes()
                manifest = self.publish()
                manifest_bytes = (self.bank / 'full-analysis.json').read_bytes()
                def reject(prompt, payload, schema, path, timeout):
                    value = {'checkedRowIds': [] if malformed else [queue[0]['rowId']], 'corrections': [],
                             'blocked': [] if malformed else [{'rowId': queue[0]['rowId'], 'reason': 'Insufficient evidence'}]}
                    full.atomic_json(path, value)
                    return value
                with self.assertRaisesRegex(ValueError, 'blocked explicit'):
                    self.run_replacement(snapshot, queue, reject)
                self.assertEqual((folder / 'verified.json').read_bytes(), initial)
                self.assertEqual((self.bank / 'full-analysis.json').read_bytes(), manifest_bytes)
                self.assertFalse(list(folder.glob('verified-before-amendment-*')))
                # Remove only synthetic failed call artifacts to exercise the other failure.
                for path in folder.glob('amendment-*'):
                    path.unlink()
                (self.work / 'input.json').unlink()

    def test_stale_row_source_and_absent_explicit_mode_reject_before_model(self):
        snapshot, folder, queue = self.prepared()
        original = (folder / 'verified.json').read_bytes()
        for key in ('beforeSHA256', 'sourceRowSHA256', 'sourceContextSHA256'):
            invalid = copy.deepcopy(queue)
            invalid[0][key] = '0' * 64
            with self.assertRaisesRegex(ValueError, 'different accepted row or source'):
                replace.replace_batch(1, snapshot['rows'], invalid, 5, self.work, kind=replace.KIND)
        with self.assertRaisesRegex(ValueError, 'queue kind'):
            replace.replace_batch(1, snapshot['rows'], queue, 5, self.work, kind='guidance')
        full.atomic_json(self.work / 'run-status.json', {'state': 'running'})
        with self.assertRaisesRegex(ValueError, 'coordinator'):
            replace.replace_batch(1, snapshot['rows'], queue, 5, self.work, kind=replace.KIND)
        self.assertEqual((folder / 'verified.json').read_bytes(), original)

    def test_reviewer_corrections_require_a_fresh_followup_review(self):
        snapshot, folder, queue = self.prepared()
        calls = []
        def reviewing(prompt, payload, schema, path, timeout):
            calls.append(path.name)
            proposal = payload['proposedRows'][0]
            value = {'checkedRowIds': [proposal['rowId']], 'blocked': [],
                     'corrections': [{**proposal, 'meaningRu': 'неожиданное препятствие'}] if len(calls) == 1 else []}
            full.atomic_json(path, value)
            return value
        self.run_replacement(snapshot, queue, reviewing)
        self.assertEqual(calls, ['amendment-0001-review-1.json', 'amendment-0001-review-2.json'])
        after = full.read(folder / 'verified.json')
        self.assertEqual(after['accepted'][queue[0]['rowId']]['file'], calls[-1])
        full.verify_receipt(after, snapshot['rows'], folder)

    def test_interrupted_author_review_resumes_exact_cached_draft(self):
        snapshot, folder, _ = self.prepared()
        queue = self.queue(snapshot['rows'][0], full.read(folder / 'verified.json')['rows'][0])
        initial = (folder / 'verified.json').read_bytes()
        def author_only(prompt, payload, schema, path, timeout):
            if path.name.endswith('example-draft.json'):
                self.assertEqual(full.MODEL, replace.AUTHOR_MODEL)
                value = {'rows': [analysis(payload['sources'][0], replace=True)]}
                full.atomic_json(path, value)
                return value
            raise RuntimeError('Interrupted independent review')
        with self.assertRaisesRegex(RuntimeError, 'Interrupted'):
            self.run_replacement(snapshot, queue, author_only)
        self.assertEqual((folder / 'verified.json').read_bytes(), initial)
        draft = folder / 'amendment-0001-example-draft.json'
        before_draft = draft.read_bytes(), draft.with_suffix('.request.json').read_bytes()
        self.run_replacement(snapshot, queue)
        self.assertEqual((draft.read_bytes(), draft.with_suffix('.request.json').read_bytes()), before_draft)

    def test_corrupt_archived_row_revision_or_chain_fails_validation(self):
        snapshot, folder, queue = self.prepared()
        self.run_replacement(snapshot, queue)
        receipt = full.read(folder / 'verified.json')
        row_id = queue[0]['rowId']
        for field, value in [('exampleRevision', 2), ('rowSHA256', '0' * 64), ('receiptFile', '../escape.json')]:
            invalid = copy.deepcopy(receipt)
            invalid['exampleHistory'][row_id][0][field] = value
            with self.assertRaises(ValueError):
                full.verify_receipt(invalid, snapshot['rows'], folder)
        archive = folder / receipt['exampleHistory'][row_id][0]['receiptFile']
        archive.write_bytes(archive.read_bytes() + b' ')
        with self.assertRaisesRegex(ValueError, 'archive changed'):
            full.verify_receipt(receipt, snapshot['rows'], folder)

    def test_guidance_only_default_stays_strict_and_preserves_existing_revision(self):
        snapshot, folder, queue = self.prepared()
        with self.assertRaisesRegex(ValueError, 'guidance'):
            amend.amend_batch(1, snapshot['rows'], [{'rowId': queue[0]['rowId'], 'beforeSHA256': queue[0]['beforeSHA256'],
                'changes': {'en': queue[0]['replacement']['en']}}], 5, self.work)
        self.run_replacement(snapshot, queue)
        before = full.read(folder / 'verified.json')
        row = before['rows'][0]
        guidance = [{'rowId': row['rowId'], 'beforeSHA256': full.value_sha(row),
                     'changes': {'meaningRu': 'неожиданная трудность в работе'}, 'reason': 'Уточнение без замены примера.'}]
        def accept_guidance(prompt, payload, schema, path, timeout):
            value = {'checkedRowIds': [row['rowId']], 'corrections': [], 'blocked': []}
            full.atomic_json(path, value)
            return value
        with patch.object(full, 'call_cli', side_effect=accept_guidance):
            amend.amend_batch(1, snapshot['rows'], guidance, 5, self.work)
        after = full.read(folder / 'verified.json')
        self.assertEqual(after['exampleRevisions'], before['exampleRevisions'])
        self.assertEqual(after['exampleHistory'], before['exampleHistory'])
        self.assertEqual(after['rows'][0]['en'], before['rows'][0]['en'])
        self.assertEqual(self.published()['exampleRevision'], 2)

    def test_replacement_rejects_unknown_metadata_and_keep_reuse(self):
        snapshot, folder, queue = self.prepared()
        for change in ({'exampleRevision': 7}, {'action': 'keep', 'en': snapshot['rows'][0]['en'], 'replacementReason': ''}):
            invalid = copy.deepcopy(queue)
            invalid[0]['replacement'].update(change)
            with self.assertRaises(ValueError):
                replace.replace_batch(1, snapshot['rows'], invalid, 5, self.work, kind=replace.KIND)

"""Regression checks for import boundaries, not claims of linguistic review."""
import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import build_context_lexicon as lex


class LexiconContractTests(unittest.TestCase):
    def fixture(self):
        text = 'A charge appeared on my account after the trial ended.'
        sense = {'id': 'sense-1', 'source': {'sourceId': 'kaikki-simple'}}
        context = {'en': text, 'ru': 'После пробного периода появилось списание.',
                   'source': {'sourceId': 'tatoeba-eng'},
                   'translationSource': {'sourceId': 'tatoeba-rus'},
                   'quality': 'imported-context', 'senseId': None,
                   'targetSpans': lex.target_spans(text, 'charge')}
        document = {'spanEncoding': 'utf-16', 'entries': [{
            'id': lex.lexical_id('charge'), 'word': 'charge', 'cefr': None,
            'senses': [sense], 'contexts': [context]}]}
        sources = [{'id': s} for s in ['kaikki-simple', 'tatoeba-eng', 'tatoeba-rus']]
        return document, sources

    def test_utf16_and_token_boundaries(self):
        text = '😀 Charge the battery; re-charge is hyphenated, charges is inflected.'
        spans = lex.target_spans(text, 'charge')
        self.assertEqual(spans, [{'start': 3, 'end': 9, 'text': 'Charge'}])
        forms = lex.target_spans(text, 'charge', ['charges'])
        self.assertEqual([s['text'] for s in forms], ['Charge', 'charges'])
        self.assertEqual(lex.target_spans("We don't write dont.", "don't")[0]['text'], "don't")
        self.assertEqual(lex.target_spans('The café opens early.', 'café')[0]['text'], 'café')

    def test_stable_ids_do_not_merge_punctuation(self):
        self.assertEqual(lex.lexical_id('Charge'), lex.lexical_id('charge'))
        self.assertNotEqual(lex.lexical_id('re-sign'), lex.lexical_id('resign'))

    def test_new_core_preserves_published_extras(self):
        words = [{'key': word, 'word': word, 'rank': {'value': i}} for i, word in enumerate(['core', 'extra', 'new-core'])]
        selected = lex.select_words(words, {'core': [], 'new-core': []}, 2, ['core', 'extra'])
        self.assertEqual({w['key'] for w in selected}, {'core', 'extra', 'new-core'})
        with self.assertRaisesRegex(ValueError, 'remove published'):
            lex.select_words(words, {}, 2, ['deleted-by-source'])

    def test_valid_unassigned_context(self):
        lex.validate_entries(*self.fixture())

    def test_no_automatic_tatoeba_sense_alignment(self):
        data, sources = self.fixture()
        data['entries'][0]['contexts'][0]['senseId'] = 'sense-1'
        with self.assertRaisesRegex(ValueError, 'must not be inferred'):
            lex.validate_entries(data, sources)

    def test_no_cefr_from_rank(self):
        data, sources = self.fixture()
        data['entries'][0]['cefr'] = 'B2'
        with self.assertRaisesRegex(ValueError, 'CEFR'):
            lex.validate_entries(data, sources)

    def test_translation_needs_its_own_attribution(self):
        data, sources = self.fixture()
        del data['entries'][0]['contexts'][0]['translationSource']
        with self.assertRaisesRegex(ValueError, 'attribution'):
            lex.validate_entries(data, sources)

    def test_corrupt_highlight_and_sense_reference_rejected(self):
        data, sources = self.fixture()
        data['entries'][0]['contexts'][0]['targetSpans'][0]['start'] += 1
        with self.assertRaisesRegex(ValueError, 'text mismatch'):
            lex.validate_entries(data, sources)
        data, sources = self.fixture()
        data['entries'][0]['contexts'][0]['senseId'] = 'absent'
        with self.assertRaisesRegex(ValueError, 'missing sense'):
            lex.validate_entries(data, sources)

    def test_duplicate_entries_and_unknown_sources_rejected(self):
        data, sources = self.fixture()
        data['entries'].append(copy.deepcopy(data['entries'][0]))
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            lex.validate_entries(data, sources)
        data, sources = self.fixture()
        data['entries'][0]['contexts'][0]['source']['sourceId'] = 'unlicensed-unknown'
        with self.assertRaisesRegex(ValueError, 'Unknown'):
            lex.validate_entries(data, sources)

    def test_membership_non_numeric_rank_is_not_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / 'NGSL_12_stats.csv').write_text('Lemma,SFI Rank\nword,3\n', encoding='utf-8')
            (path / 'NGSL-GR_rank.csv').write_text('Word,WordID\nword,5\n', encoding='utf-8')
            (path / 'NGSL-Spoken_12_stats.csv').write_text('Lemma,Rank\nTRUE,#N/A\n', encoding='utf-8')
            (path / 'SUP_lemmatized.csv').write_text('Monday,Mondays\n', encoding='utf-8')
            (path / 'NAWL_12_alphabetized_description.txt').write_text('Academic word list\nconcept\n', encoding='utf-8')
            with patch.object(lex, 'CACHE', path):
                data = lex.memberships()
            self.assertIsNone(data['true'][0]['value'])
            self.assertEqual(data['true'][0]['sourceRankValue'], '#N/A')
            self.assertNotIn('mondays', data)

    def test_dictionary_fallback_retains_source_sense(self):
        example = {'en': 'Her sculpture stands beside the entrance.', 'targetSpans': lex.target_spans('Her sculpture stands beside the entrance.', 'sculpture')}
        sense = {'id': 'sculpture-n-1', 'examples': [example], 'source': {'sourceId': 'kaikki-simple'}}
        result = lex.add_dictionary_contexts({}, {'sculpture': [sense]})
        self.assertEqual(result['sculpture'][0]['senseId'], 'sculpture-n-1')
        self.assertIsNone(result['sculpture'][0]['ru'])
        self.assertEqual(result['sculpture'][0]['quality'], 'source-linked-context')

    def test_refined_selection_retains_published_contexts_without_new_unreviewed_fallbacks(self):
        old = {'word': 'mar', 'contexts': [
            {'id': 'source-a', 'en': 'Old source quotation.', 'senseId': 'sense-a'},
            {'id': 'source-b', 'en': 'Previous version.', 'senseId': None}],
            'senses': [{'id': 'sense-a', 'definition': 'Original source sense'}]}
        contexts = {'mar': [
            {'id': 'source-b', 'en': 'Refreshed source version.', 'senseId': None},
            {'id': 'new-selection', 'en': 'Unreviewed fallback.', 'senseId': None, 'ru': None}]}
        dictionary = {}
        lex.retain_published_contexts(contexts, dictionary, [old])
        self.assertEqual([c['id'] for c in contexts['mar']], ['source-a', 'source-b'])
        self.assertEqual(contexts['mar'][0]['en'], 'Old source quotation.')
        self.assertEqual(contexts['mar'][1]['en'], 'Refreshed source version.')
        self.assertEqual(dictionary['mar'][0]['id'], 'sense-a')
        contexts['mar'][0]['en'] = 'Changed copy'
        self.assertEqual(old['contexts'][0]['en'], 'Old source quotation.')

    def test_real_pilot_all_twenty_contexts_are_complete(self):
        document = json.loads((lex.OUT / 'pilot.json').read_text(encoding='utf-8'))
        source_path = lex.OUT / 'pilot-sources.json'
        if not source_path.exists():
            source_path = lex.OUT / 'sources.json'
        sources = json.loads(source_path.read_text(encoding='utf-8'))['sources']
        lex.validate_entries(document, sources)
        self.assertEqual(len(document['entries']), 20)
        for entry in document['entries']:
            self.assertEqual(len(entry['contexts']), 1)
            context = entry['contexts'][0]
            self.assertEqual(context['quality'], 'context-reviewed')
            self.assertTrue(context['productionTask'] and context['explanation'] and context['ru'])
            self.assertEqual(context['senseId'], entry['senses'][0]['id'])

    def test_unapproved_editorial_chunk_is_excluded(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / 'editorial-contexts.json').write_text('{"entries":[]}', encoding='utf-8')
            (path / 'editorial-core-01.json').write_text('{"approved":false,"entries":[]}', encoding='utf-8')
            with patch.object(lex, 'OUT', path):
                self.assertEqual([p.name for p, _ in lex.editorial_documents()], ['editorial-contexts.json'])

    def test_every_required_source_headword_is_published(self):
        entries = json.loads((lex.OUT / 'entries.json').read_text(encoding='utf-8'))['entries']
        actual = {lex.normalized_word(e['word']): e for e in entries}
        required = lex.memberships()
        self.assertFalse(set(required) - set(actual))
        for key, memberships in required.items():
            self.assertTrue(actual[key]['contexts'], key)
            self.assertEqual(actual[key]['memberships'], memberships)
        self.assertEqual(actual['multi']['lexicalType'], 'combining-form')
        self.assertEqual(actual['neo']['displayHeadword'], 'neo-')
        self.assertEqual(actual['café']['lexicalType'], 'spelling-variant')

    def test_all_editorial_chunks_have_independent_review_and_valid_links(self):
        seen = set()
        for path, data in lex.editorial_documents():
            if path.name.startswith('editorial-core-'):
                self.assertTrue(data['approved'])
                self.assertEqual(data['review']['status'], 'independently-reviewed')
            dictionary = {}
            contexts = lex.add_editorial_document({}, dictionary, data)
            for row in data['entries']:
                key = lex.normalized_word(row['word'])
                self.assertNotIn(key, seen)
                seen.add(key)
                for field in ['meaningEn', 'meaningRu', 'en', 'ru', 'explanation', 'phrase', 'task']:
                    self.assertTrue(row[field].strip(), (key, field))
                self.assertEqual(contexts[key][0]['senseId'], dictionary[key][0]['id'])
        self.assertEqual(len(seen), 208)

    def test_pilot_rebuild_does_not_replace_published_data_or_metadata(self):
        if not (lex.CACHE / 'context-candidates.json').exists():
            self.skipTest('Source cache unavailable')
        paths = [lex.OUT / name for name in ['entries.json', 'sources.json', 'coverage.json', 'required-gaps.json']]
        before = {p: lex.file_sha(p) for p in paths}
        subprocess.run([sys.executable, str(lex.APP / 'scripts' / 'build_context_lexicon.py'), '--pilot'], check=True, capture_output=True, text=True)
        self.assertEqual(before, {p: lex.file_sha(p) for p in paths})

    def test_published_dataset_when_present(self):
        path = lex.OUT / 'entries.json'
        if not path.exists():
            self.skipTest('First publication has not happened yet')
        document = json.loads(path.read_text(encoding='utf-8'))
        sources = json.loads((lex.OUT / 'sources.json').read_text(encoding='utf-8'))['sources']
        lex.validate_entries(document, sources)
        coverage = json.loads((lex.OUT / 'coverage.json').read_text(encoding='utf-8'))
        self.assertEqual(coverage['outputSHA256'], lex.file_sha(path))
        self.assertEqual(coverage['publishedWords'], len(document['entries']))
        self.assertGreaterEqual(len(document['entries']), 10000)


if __name__ == '__main__':
    unittest.main()

"""Offline publication checks; no source PDFs, learner data or model calls."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import generate_new_coursebooks as pipeline
import publish_new_coursebooks as publish
import publish_book_release as release
from test_generate_new_coursebooks import bundle_fixture, write_json


class CoursebookPublicationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.content = self.root / 'app/content'
        self.content.mkdir(parents=True)
        self.work = self.root / 'private-build'
        self.bundle, self.analysis, self.lesson = bundle_fixture(self.root)
        # This lower-level publication fixture has no intake directory. Source
        # reconstruction is exercised against real packs in pipeline tests.
        self.current_patcher = patch.object(pipeline, 'current_bundle', side_effect=deepcopy)
        self.current_patcher.start()
        self.addCleanup(self.current_patcher.stop)
        self.bundle['source']['source'] = 'ocr'
        source_file = self.bundle['sourceFiles'][0]
        write_json(source_file['path'], self.bundle['source'])
        source_file['sha256'] = pipeline.file_sha(source_file['path'])
        self.bundle.pop('sourceSetSha256')
        self.bundle['sourceSetSha256'] = pipeline.template.value_sha(self.bundle)
        self.analysis['bundleSha256'] = self.bundle['sourceSetSha256']
        chapter = self.bundle['chapter']
        self.folder = self.work / 'units' / chapter['unitId'] / self.bundle['sourceSetSha256']
        self.unit = {'id': chapter['unitId'], 'unit': 1, 'title': 'Paragraphs',
                     'page': chapter['pages'][0], 'endPage': chapter['pages'][-1], 'pages': chapter['pages'], 'printedPage': 2}
        self.book = {'id': chapter['bookId'], 'title': 'Writing', 'filename': 'more/Writing.pdf',
                     'tocPages': [3], 'pdfPageCount': 100, 'unitCount': 1, 'units': [self.unit]}
        self.catalog = {'version': 1, 'books': []}
        write_json(self.content / 'library.json', self.catalog)

    def fake_model(self, prompt, payload, schema, attachments, path, timeout):
        fields = schema['properties']
        if 'requiredPoints' in fields:
            result = deepcopy(self.analysis)
        elif 'sections' in fields:
            result = deepcopy(self.lesson)
            result['provenance'].update(deepcopy(payload['requiredProvenance']))
        else:
            result = {'unitId': self.unit['id'], 'candidateSha256': payload['candidateSha256'], 'decision': 'accept', 'findings': []}
            key = 'inputSha256' if 'inputSha256' in fields else 'requestSha256'
            result[key] = payload[key]
        write_json(path, result)
        return result

    def ready(self):
        with patch.object(pipeline, 'call_model', side_effect=self.fake_model):
            pipeline.run_chapter(self.bundle, self.folder, timeout=10)
        return {'book': self.book, 'unit': self.unit, 'bundle': self.bundle,
                'receipt': pipeline.read(self.folder / 'verified.json'), 'folder': self.folder}

    def test_incomplete_set_does_not_write_catalog_or_lessons(self):
        before = (self.content / 'library.json').read_bytes()
        with self.assertRaisesRegex(ValueError, 'await'):
            publish.publish([], ['missing-unit'], self.content, self.work)
        self.assertEqual((self.content / 'library.json').read_bytes(), before)
        self.assertFalse((self.content / 'book-lessons').exists())

    def test_full_reviewed_chapter_survives_combined_portable_release(self):
        record = self.ready()
        result = publish.publish([record], [], self.content, self.work)
        self.assertEqual(result, {'newChapters': 1, 'ready': 1, 'total': 1})
        catalog = pipeline.read(self.content / 'library.json')
        self.assertEqual(catalog['uniqueUnits'], 1)
        self.assertEqual(catalog['books'][0]['units'][0]['pages'], self.unit['pages'])
        lesson = pipeline.read(self.content / 'book-lessons' / (self.unit['id'] + '.json'))
        self.assertEqual(lesson, record['receipt']['lesson'])
        self.assertGreater(len(lesson['exercises']), 8)
        manifest, rejected = release.build_release(self.content, self.content.parent / 'data/parsed-books', self.content.parent / 'data/book-page-images', self.work)
        self.assertEqual(rejected, {})
        self.assertEqual(manifest['ready'], 1)
        self.assertNotIn('text', manifest['units'][self.unit['id']])
        # An identical retry is safe and retains the exact source/lesson data.
        self.assertEqual(publish.publish([record], [], self.content, self.work), result)

    def test_changed_reviewed_lesson_or_source_cannot_be_published(self):
        record = self.ready()
        changed = deepcopy(record)
        changed['receipt']['lesson']['sections'][0]['body'] += ' Changed after acceptance.'
        with self.assertRaises(ValueError):
            publish.publish([changed], [], self.content, self.work)
        self.assertFalse((self.content / 'book-lessons').exists())
        Path(self.bundle['attachments'][0]['path']).write_bytes(b'changed source')
        with self.assertRaises(ValueError):
            publish.publish([record], [], self.content, self.work)

    def test_late_added_unit_evidence_invalidates_stored_publication_receipt(self):
        record = self.ready()
        fresh = deepcopy(self.bundle)
        fresh['source']['additionalEvidenceNotes'] = ['A newly supplied prerequisite is required.']
        fresh['sourceSetSha256'] = pipeline.template.value_sha({
            key: value for key, value in fresh.items() if key != 'sourceSetSha256'})
        with patch.object(pipeline, 'current_bundle', return_value=fresh), \
                self.assertRaisesRegex(ValueError, 'source identity changed'):
            publish.validate_published_coursebook(record['receipt']['lesson'], self.work)

    def test_new_plan_cannot_use_legacy_eight_task_validation(self):
        record = self.ready()
        publish.publish([record], [], self.content, self.work)
        wrong_work = self.root / 'missing-semantic-evidence'
        _, rejected = release.build_release(self.content, self.content.parent / 'data/parsed-books', self.content.parent / 'data/book-page-images', wrong_work)
        self.assertIn('independently reviewed', rejected[self.unit['id']])

    def test_catalog_preserves_old_units_and_refuses_partial_books(self):
        record = self.ready()
        existing = {'version': 1, 'books': [{'id':'old-book', 'units':[{'id':'old-001'}]}]}
        merged = publish.merged_catalog(existing, [record])
        self.assertEqual(merged['books'][0], existing['books'][0])
        self.assertEqual(existing['books'], [{'id':'old-book', 'units':[{'id':'old-001'}]}])
        record['book']['unitCount'] = 2
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            publish.merged_catalog(existing, [record])


if __name__ == '__main__':
    unittest.main()

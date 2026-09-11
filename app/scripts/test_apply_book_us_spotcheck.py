import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import apply_book_us_spotcheck as migration


class BookCorrectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = Path(self.temp.name)
        (self.app / 'content/book-lessons').mkdir(parents=True)
        self.book = self.app / 'content/book-lessons/grammar-elementary-034.json'
        self.book.write_text(json.dumps({'id': 'book-grammar-elementary-034', 'formula': 'old', 'provenance': {'sourceHash': 'original-source'}}), encoding='utf-8')
        self.before = self.book.read_bytes()
        self.plan = self.app / 'content/book-us-spotcheck-corrections.json'
        self.plan.write_text(json.dumps({'version': 1, 'id': '2026-09-10-book-us-spotcheck', 'changes': [
            {'lessonId': 'book-grammar-elementary-034', 'path': ['formula'], 'before': 'old', 'after': 'reviewed'}]}), encoding='utf-8')
        self.manifest = self.app / 'content/book-release.json'
        self.manifest.write_bytes(b'{"old": true}\n')
        validator = patch.object(migration, 'validate_lesson')
        validator.start()
        self.addCleanup(validator.stop)

    def test_stale_field_fails_before_any_write(self):
        plan = json.loads(self.plan.read_text())
        plan['changes'][0]['before'] = 'different original'
        self.plan.write_text(json.dumps(plan))
        with self.assertRaisesRegex(ValueError, 'Stale correction'):
            migration.apply(self.app)
        self.assertEqual(self.book.read_bytes(), self.before)
        self.assertFalse((self.app / 'data').exists())

    def test_rejected_release_restores_exact_lesson_and_manifest_bytes(self):
        with patch.object(migration, 'build_release', return_value=({'ready': 0, 'total': 1}, {'unit': 'bad source'})):
            with self.assertRaisesRegex(ValueError, 'did not pass'):
                migration.apply(self.app)
        self.assertEqual(self.book.read_bytes(), self.before)
        self.assertEqual(self.manifest.read_bytes(), b'{"old": true}\n')
        self.assertFalse((self.app / 'content/book-us-spotcheck-release.json').exists())

    def test_applied_clone_is_idempotent_without_reopening_private_sources(self):
        with patch.object(migration, 'build_release', return_value=({'ready': 1, 'total': 1}, {})) as publish:
            self.assertEqual(migration.apply(self.app)['changedLessons'], 1)
            self.assertEqual(migration.apply(self.app)['changedLessons'], 0)
            publish.assert_called_once()
        self.assertEqual(json.loads(self.book.read_bytes())['provenance']['sourceHash'], 'original-source')


if __name__ == '__main__':
    unittest.main()

import hashlib
from pathlib import Path
import tempfile
import unittest

from cache_book_recordings import cache_recordings


class RecordingCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.books, self.cache = self.root / "books", self.root / "cache"
        self.books.mkdir()
        self.raw = b"ID3 exact original audio bytes"
        (self.books / "01.mp3").write_bytes(self.raw)
        self.registry = {"version": 1, "recordings": [{"id": "clear-track-001.mp3", "filename": "01.mp3",
            "bytes": len(self.raw), "sha256": hashlib.sha256(self.raw).hexdigest()}]}

    def test_copy_is_exact_and_repeat_preserves_existing_bytes(self):
        result = cache_recordings(self.registry, self.books, self.cache)
        self.assertEqual((result["verified"], result["copied"]), (1, 1))
        self.assertEqual((self.cache / "clear-track-001.mp3").read_bytes(), self.raw)
        self.assertEqual((self.books / "01.mp3").read_bytes(), self.raw)
        self.assertEqual(cache_recordings(self.registry, self.books, self.cache)["copied"], 0)

    def test_changed_existing_copy_is_never_replaced(self):
        self.cache.mkdir()
        target = self.cache / "clear-track-001.mp3"
        target.write_bytes(b"local changed file")
        with self.assertRaises(ValueError): cache_recordings(self.registry, self.books, self.cache)
        self.assertEqual(target.read_bytes(), b"local changed file")

    def test_all_sources_validated_before_any_copy_and_traversal_rejected(self):
        bad = {**self.registry["recordings"][0], "id": "clear-track-002.mp3", "filename": "02.mp3"}
        (self.books / "02.mp3").write_bytes(b"wrong")
        self.registry["recordings"].append(bad)
        with self.assertRaises(ValueError): cache_recordings(self.registry, self.books, self.cache)
        self.assertFalse(self.cache.exists())
        self.registry["recordings"] = [bad]
        for name in ("../01.mp3", "/01.mp3", "C:/01.mp3", "folder\\01.mp3", "folder/../01.mp3"):
            bad["filename"] = name
            with self.subTest(name=name), self.assertRaises(ValueError):
                cache_recordings(self.registry, self.books, self.cache)


if __name__ == "__main__":
    unittest.main()

"""Portable-release regressions. Uses synthetic teaching/source data only."""
import contextlib
import copy
import io
import json
from pathlib import Path
import tempfile
import unittest

import publish_book_release as release
from test_build_book_lessons import valid_lesson


class BookReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.content, self.sources, self.images = root / "content", root / "parsed-books", root / "page-images"
        self.id = "grammar-001"
        self.entry = {"bookId": "grammar", "pages": [10, 11]}
        self.source = {"unitId": self.id, **self.entry, "source": "text-layer-layout", "text": "Private original source.\nI'm working.\nРусский текст."}
        self.lesson = valid_lesson()
        self.lesson.update(id="book-" + self.id, level="B1", generated=True)
        self.lesson["provenance"].update(unitId=self.id, **self.entry, source=self.source["source"], sourceHash=release.digest(self.source["text"].encode("utf-8")), visualSourceUsed=True)
        self.lesson["provenance"]["visualCoverage"] = [{"page": page, "observations": "На странице видны контрастные формы и контекст использования грамматического времени."} for page in (10, 11)]
        self.lesson["provenance"]["sourceImages"] = []
        for page in self.entry["pages"]:
            image = b"\xff\xd8" + f"private original image {page}".encode() + b"\xff\xd9"
            path = self.images / "grammar" / f"{page}.jpg"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(image)
            self.lesson["provenance"]["sourceImages"].append({"page": page, "sha256": release.digest(image)})
        release.atomic_json(self.sources / f"{self.id}.json", self.source)
        self.lesson_path = self.content / "book-lessons" / f"{self.id}.json"
        release.atomic_json(self.lesson_path, self.lesson)
        release.atomic_json(self.content / "library.json", {"books": [
            {"id": "grammar", "units": [{"id": self.id, "page": 10, "endPage": 11}, {"id": "grammar-002", "page": 12, "endPage": 13}]},
            {"id": "duplicate", "duplicateOf": "grammar", "units": [{"id": "duplicate-001", "page": 10, "endPage": 11}]},
        ]})

    def build(self):
        return release.build_release(self.content, self.sources, self.images)

    def args(self):
        return ["--content", str(self.content), "--sources", str(self.sources), "--images", str(self.images)]

    def test_only_prepared_canonical_units_are_published(self):
        manifest, rejected = self.build()
        self.assertEqual(rejected, {})
        self.assertEqual((manifest["total"], manifest["ready"]), (2, 1))
        self.assertEqual(set(manifest["units"]), {self.id})
        item = manifest["units"][self.id]
        self.assertEqual(item["lessonSHA256"], release.digest(self.lesson_path.read_bytes()))
        self.assertEqual(item["sourceImages"], self.lesson["provenance"]["sourceImages"])
        encoded = json.dumps(manifest)
        for private in (self.source["text"], "private original", str(self.sources), "sourceCoverage", "observations"):
            self.assertNotIn(private, encoded)

    def test_every_private_provenance_dependency_is_checked(self):
        for scenario in ("source text", "source pages", "source method", "source missing", "image bytes", "image missing", "image page", "incomplete lesson"):
            with self.subTest(scenario=scenario):
                original_source = (self.sources / f"{self.id}.json").read_bytes()
                image_path = self.images / "grammar/10.jpg"
                original_image = image_path.read_bytes()
                try:
                    source, lesson = copy.deepcopy(self.source), copy.deepcopy(self.lesson)
                    if scenario == "source text":
                        source["text"] += "Changed meaning."
                    elif scenario == "source pages":
                        source["pages"] = [11, 12]
                    elif scenario == "source method":
                        source["source"] = "unknown"
                    elif scenario == "image bytes":
                        image_path.write_bytes(b"\xff\xd8different\xff\xd9")
                    elif scenario == "image missing":
                        image_path.unlink()
                    elif scenario == "image page":
                        lesson["provenance"]["sourceImages"][0]["page"] = 11
                    elif scenario == "incomplete lesson":
                        lesson["exercises"] = []
                    release.atomic_json(self.sources / f"{self.id}.json", source)
                    release.atomic_json(self.lesson_path, lesson)
                    if scenario == "source missing":
                        (self.sources / f"{self.id}.json").unlink()
                    manifest, rejected = self.build()
                    self.assertEqual(manifest["ready"], 0)
                    self.assertEqual(set(rejected), {self.id})
                finally:
                    (self.sources / f"{self.id}.json").write_bytes(original_source)
                    image_path.write_bytes(original_image)
                    release.atomic_json(self.lesson_path, self.lesson)

    def test_exact_bytes_are_pinned_including_line_endings(self):
        original = self.lesson_path.read_bytes()
        first, _ = self.build()
        self.lesson_path.write_bytes(original.replace(b"\n", b"\r\n"))
        second, rejected = self.build()
        self.assertFalse(rejected)
        self.assertNotEqual(first["units"][self.id]["lessonSHA256"], second["units"][self.id]["lessonSHA256"])
        self.assertEqual(second["units"][self.id]["lessonSHA256"], release.digest(self.lesson_path.read_bytes()))

    def test_check_does_not_write_and_invalid_run_preserves_previous_release(self):
        output = self.content / "book-release.json"
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(release.main(self.args() + ["--check"]), 0)
            self.assertFalse(output.exists())
            self.assertEqual(release.main(self.args()), 0)
            previous = output.read_bytes()
            self.lesson_path.write_text("{}", encoding="utf-8")
            self.assertEqual(release.main(self.args()), 1)
            self.assertEqual(output.read_bytes(), previous)

    def test_explicit_partial_release_cannot_claim_invalid_lessons(self):
        release.atomic_json(self.content / "book-lessons/unknown.json", self.lesson)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(release.main(self.args() + ["--skip-invalid"]), 0)
        manifest = json.loads((self.content / "book-release.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["ready"], 1)
        self.assertNotIn("unknown", manifest["units"])

    def test_atomic_failure_preserves_the_prior_inventory(self):
        path = self.content / "book-release.json"
        release.atomic_json(path, {"preserved": True})
        with self.assertRaises(TypeError):
            release.atomic_json(path, {"bad": object()})
        self.assertEqual(json.loads(path.read_text()), {"preserved": True})
        self.assertEqual(list(self.content.glob("book-release-*.tmp")), [])

    def test_long_chapter_release_requires_every_middle_page(self):
        pages = [10, 11, 12, 13, 14]
        catalog_path = self.content / "library.json"
        catalog = json.loads(catalog_path.read_text())
        catalog["books"][0]["units"][0]["endPage"] = 14
        release.atomic_json(catalog_path, catalog)
        self.source["pages"] = pages
        self.source["pageTexts"] = [{"page": page, "text": "Private text."} for page in pages]
        release.atomic_json(self.sources / f"{self.id}.json", self.source)
        provenance = self.lesson["provenance"]
        provenance["pages"] = pages
        provenance["visualCoverage"] = [{"page": page, "observations": "На странице видны контрастные формы и контекст использования грамматического времени."} for page in pages]
        provenance["sourceImages"] = []
        for page in pages:
            image = b"\xff\xd8" + f"full chapter page {page}".encode() + b"\xff\xd9"
            (self.images / "grammar" / f"{page}.jpg").write_bytes(image)
            provenance["sourceImages"].append({"page": page, "sha256": release.digest(image)})
        release.atomic_json(self.lesson_path, self.lesson)
        manifest, rejected = self.build()
        self.assertFalse(rejected)
        self.assertEqual(manifest["units"][self.id]["pages"], pages)
        image = self.images / "grammar/12.jpg"
        image.write_bytes(b"\xff\xd8changed middle image\xff\xd9")
        manifest, rejected = self.build()
        self.assertEqual(manifest["ready"], 0)
        self.assertIn("image changed", rejected[self.id])
        del provenance["sourceImages"][2]
        release.atomic_json(self.lesson_path, self.lesson)
        manifest, rejected = self.build()
        self.assertEqual(manifest["ready"], 0)
        self.assertIn("Every source page", rejected[self.id])

    def test_long_catalog_rejects_old_endpoint_source(self):
        catalog_path = self.content / "library.json"
        catalog = json.loads(catalog_path.read_text())
        catalog["books"][0]["units"][0]["endPage"] = 14
        release.atomic_json(catalog_path, catalog)
        self.source["pages"] = [10, 14]
        release.atomic_json(self.sources / f"{self.id}.json", self.source)
        manifest, rejected = self.build()
        self.assertEqual(manifest["ready"], 0)
        self.assertIn(self.id, rejected)


if __name__ == "__main__":
    unittest.main()

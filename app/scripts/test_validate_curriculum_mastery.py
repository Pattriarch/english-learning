"""Small isolated cross-reference fixtures; no application profile or network."""
from contextlib import redirect_stdout
from copy import deepcopy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest

import validate_curriculum_mastery as audit


class CurriculumMasteryIntegrityTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name)
        self.content = self.repo / "app" / "content"
        self.write("curriculum.json", [{"id": "ordinary", "exercises": [{"id": "e1"}]}])
        self.write("courses/addition.json", [{"id": "course-topic", "exercises": [{"id": "e2"}]}])
        self.write("library.json", {"books": [{"id": "book", "units": [{"id": "book-unit"}]}]})
        self.write("book-lessons/book-unit.json", {"id": "book-book-unit", "exercises": [{"id": "e3"}]})
        self.write("pronunciation.json", {"lessons": [{"id": "pron-rhythm"}]})
        self.write("research-topics.json", {"topics": [{"id": "reasoning"}]})
        self.write("projects-checkpoints.json", {"units": [{"id": "project-one", "tasks": [{"id": "speaking"}]}]})
        self.write("learning-path.json", {"levels": [{"id": "A1", "lessonIds": ["ordinary", "course-topic"]}]})
        refs = [
            {"lessonId": "ordinary", "exerciseIds": ["e1"], "file": "app/content/curriculum.json"},
            {"lessonId": "course-topic", "exerciseIds": ["e2"]},
            {"lessonId": "book-book-unit", "unitId": "book-unit", "exerciseIds": ["e3"]},
            {"lessonId": "pron-rhythm", "exerciseIds": []},
            {"lessonId": "pronunciation", "exerciseIds": ["pron-rhythm"]},
            {"lessonId": "project-project-one", "exerciseIds": ["speaking", "revision", "transfer"]},
            {"lessonId": "research", "exerciseIds": ["reasoning"]},
        ]
        self.catalog = {"levels": [{"level": "A1", "indicators": [{"id": "one", "evidence": refs}]}],
                        "snapshotFiles": [{"file": "app/content/curriculum.json", "sha256": hashlib.sha256((self.content / "curriculum.json").read_bytes()).hexdigest()}]}
        self.write("curriculum-mastery-map.json", self.catalog)

    def write(self, name, value):
        path = self.content / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding="utf-8")
        return path

    def test_valid_varied_references_and_read_only_output(self):
        before = {p: p.read_bytes() for p in self.content.rglob("*.json")}
        result = audit.validate(self.content, self.repo)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["checks"]["evidence"], 7)
        self.assertEqual(result["checks"]["exercises"], 8)
        self.assertEqual(result["checks"]["pathLessons"], 2)
        self.assertEqual(before, {p: p.read_bytes() for p in self.content.rglob("*.json")})

    def test_missing_targets_do_not_pass_as_existing_routes(self):
        for index, field, value, code in [
            (0, "lessonId", "missing-lesson", "missing_lesson"),
            (1, "exerciseIds", ["missing-exercise"], "missing_exercise"),
            (2, "unitId", "missing-book", "missing_book_unit"),
            (3, "lessonId", "pron-missing", "missing_lesson"),
            (5, "lessonId", "project-missing", "missing_lesson"),
            # unitId is reserved for book routes in the actual mastery router.
            (5, "unitId", "project-one", "missing_book_unit"),
        ]:
            with self.subTest(value=value):
                broken = deepcopy(self.catalog)
                broken["levels"][0]["indicators"][0]["evidence"][index][field] = value
                self.write("curriculum-mastery-map.json", broken)
                result = audit.validate(self.content, self.repo)
                self.assertFalse(result["ok"])
                self.assertIn(code, {e["code"] for e in result["errors"]})
        self.write("curriculum-mastery-map.json", self.catalog)
        # Files in the obsolete lessons directory are not loaded by the server.
        self.write("lessons/ghost.json", {"id": "ghost", "exercises": [{"id": "e1"}]})
        self.write("learning-path.json", {"levels": [{"id": "A1", "lessonIds": ["ghost"]}]})
        self.assertIn("missing_path_lesson", {e["code"] for e in audit.validate(self.content, self.repo)["errors"]})

    def test_stale_hash_and_duplicate_indicator_fail_cli_without_rewriting(self):
        self.catalog["levels"].append({"level": "A2", "indicators": deepcopy(self.catalog["levels"][0]["indicators"])})
        self.write("curriculum-mastery-map.json", self.catalog)
        with (self.content / "curriculum.json").open("a", encoding="utf-8") as stream:
            stream.write("\n")
        before = (self.content / "curriculum-mastery-map.json").read_bytes()
        output = io.StringIO()
        with redirect_stdout(output):
            status = audit.main(["--content", str(self.content), "--repo-root", str(self.repo)])
        self.assertEqual(status, 1)
        result = json.loads(output.getvalue())
        self.assertTrue({"stale_snapshot", "duplicate_indicator"}.issubset({e["code"] for e in result["errors"]}))
        self.assertEqual(before, (self.content / "curriculum-mastery-map.json").read_bytes())


if __name__ == "__main__":
    unittest.main()

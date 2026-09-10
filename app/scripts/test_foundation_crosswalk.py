"""Readiness regressions using isolated files, without lesson generation."""
from contextlib import redirect_stdout
from copy import deepcopy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import refresh_foundation_crosswalk as audit


def sources(target="ready"):
    result = []
    specifications = (("ef-a1", 12, "AB", 6), ("ef-b1", 10, "AB", 5),
                      ("speakout-a2", 8, "ABCD", 0), ("speakout-b2", 8, "ABCD", 0))
    for identifier, count, letters, practical in specifications:
        rows = []
        codes = [f"{number}{letter}" for number in range(1, count + 1) for letter in letters]
        codes += [f"PE{number}" for number in range(1, practical + 1)]
        for code in codes:
            if code.startswith("PE"):
                kinds = ["skills"]
            else:
                kinds = ["grammar", "vocabulary"]
                if not identifier.startswith("speakout-") or not code.endswith("D"):
                    kinds.append("pronunciation")
                if identifier != "ef-a1":
                    kinds.append("skills")
                if identifier == "speakout-b2" and code.endswith("D"):
                    kinds = ["grammar" if int(code[:-1]) % 2 else "vocabulary", "skills"]
            rows.append(dict(code=code, label="Fixture topic", dimensions=[
                dict(kind=kind, coverage="mapped", targets=[target]) for kind in kinds]))
        result.append(dict(id=identifier, title=identifier, rows=rows))
    return result


def lesson(identifier="ready"):
    return dict(id=identifier, title="Prepared fixture", level="A2", sections=[
        dict(title=f"Section {number}", body="Prepared explanation.") for number in range(3)
    ], exercises=[dict(id="e1", prompt="Describe the situation.",
                       explanation="Specific explanation.", answers=["A complete illustrative answer."])])


class FoundationCrosswalkTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.app = Path(temporary.name)
        self.content = self.app / "content"
        for name, value in (("APP", self.app), ("CONTENT", self.content)):
            replacement = patch.object(audit, name, value)
            replacement.start()
            self.addCleanup(replacement.stop)
        self.write("content/library.json", {"books": []})
        self.write("content/book-release.json", {"units": {}})
        self.write("content/extended-course-plan.json", {"modules": []})
        self.write("content/pronunciation.json", {"lessons": []})
        self.write("content/curriculum.json", [lesson()])

    def write(self, relative, value):
        path = self.app / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        return path

    def refresh(self, rows):
        self.write("content/foundation-book-crosswalk.json", {"sources": rows, "targets": {}})
        with patch.object(audit, "atomic_json") as publish, patch.object(audit, "write_report") as report:
            with redirect_stdout(io.StringIO()):
                result = audit.refresh()
            publish.assert_called_once()
            report.assert_called_once_with(result)
        return result

    def test_required_columns_include_speakout_abc_but_not_d(self):
        original = sources()
        self.assertEqual(audit.validate_rows(original), ["ready"])
        for source_index, source in enumerate(original):
            for row_index, row in enumerate(source["rows"]):
                if row["code"].startswith("PE"):
                    continue
                for dimension in row["dimensions"]:
                    with self.subTest(source=source["id"], row=row["code"], kind=dimension["kind"]):
                        changed = deepcopy(original)
                        changed[source_index]["rows"][row_index]["dimensions"] = [
                            item for item in row["dimensions"] if item["kind"] != dimension["kind"]]
                        with self.assertRaisesRegex(ValueError, "advertised column is missing"):
                            audit.validate_rows(changed)
        for row in original[2]["rows"]:
            if row["code"].endswith("D"):
                self.assertNotIn("pronunciation", [item["kind"] for item in row["dimensions"]])

    def test_b2_d_rows_preserve_alternating_source_columns(self):
        original = sources()
        for row in original[3]["rows"]:
            if not row["code"].endswith("D"):
                continue
            expected = {"grammar", "skills"} if int(row["code"][:-1]) % 2 else {"vocabulary", "skills"}
            self.assertEqual({item["kind"] for item in row["dimensions"]}, expected)
        changed = deepcopy(original)
        changed[3]["rows"][3]["dimensions"].append(
            dict(kind="pronunciation", coverage="mapped", targets=["ready"]))
        with self.assertRaisesRegex(ValueError, "unadvertised column"):
            audit.validate_rows(changed)

    def test_duplicate_rows_dimensions_and_targets_are_rejected(self):
        for duplicate in ("row", "dimension", "target"):
            with self.subTest(duplicate=duplicate):
                changed = sources()
                row = changed[0]["rows"][0]
                if duplicate == "row":
                    changed[0]["rows"][1] = deepcopy(row)
                elif duplicate == "dimension":
                    row["dimensions"].append(deepcopy(row["dimensions"][0]))
                else:
                    row["dimensions"][0]["targets"].append("ready")
                with self.assertRaisesRegex(ValueError, "[Dd]uplicate"):
                    audit.validate_rows(changed)

    def test_reference_readiness_requires_nonempty_strings_in_a_list(self):
        for answers in (None, [], "An answer is not a list", [""], [" \n\t"],
                        [None], ["A valid answer.", ""]):
            with self.subTest(answers=answers):
                prepared = lesson()
                prepared["exercises"][0]["answers"] = answers
                self.assertEqual(audit.course_evidence(prepared)["referencesPending"], ["e1"])
        self.assertEqual(audit.course_evidence(lesson())["referencesPending"], [])

    def test_unknown_id_and_duplicate_course_id_abort_before_publication(self):
        for invalid in ("unknown", "duplicate-course"):
            with self.subTest(invalid=invalid):
                self.write("content/foundation-book-crosswalk.json", {
                    "sources": sources("missing" if invalid == "unknown" else "ready")})
                self.write("content/curriculum.json", [lesson()] * (2 if invalid == "duplicate-course" else 1))
                with patch.object(audit, "atomic_json") as publish, patch.object(audit, "write_report") as report:
                    with self.assertRaisesRegex(ValueError, "Unknown lesson ID|Duplicate course ID"):
                        audit.refresh()
                    publish.assert_not_called()
                    report.assert_not_called()

    def test_readiness_counts_unique_evidence_without_overwriting_editorial_coverage(self):
        pending = lesson("pending")
        pending["exercises"][0]["answers"] = [" "]
        self.write("content/curriculum.json", [lesson(), pending])
        self.write("content/extended-course-plan.json", {
            "modules": [dict(id="planned", title="A specification without a prepared lesson")]})
        rows = sources()
        dimension = rows[0]["rows"][0]["dimensions"][0]
        dimension.update(coverage="partial", targets=["ready", "pending", "planned"])
        result = self.refresh(rows)
        self.assertEqual(result["availabilitySummary"], {
            "available": 1, "reference-pending": 1, "catalog-only": 1})
        self.assertEqual(result["targets"]["pending"]["evidence"]["referencesPending"], ["e1"])
        self.assertEqual(result["sources"][0]["rows"][0]["dimensions"][0]["coverage"], "partial")
        self.assertEqual(result["sources"][0]["availabilitySummary"], result["availabilitySummary"])
        self.assertEqual(result["sources"][1]["availabilitySummary"], {"available": 1})

    def test_changed_local_source_cannot_fall_back_to_matching_portable_release(self):
        identifier = "grammar-fixture-001"
        self.write("content/library.json", {"books": [dict(
            id="grammar-fixture", title="Fixture book", level="A2",
            units=[dict(id=identifier, title="Fixture unit", page=1, endPage=2)])]})
        file = self.write(f"content/book-lessons/{identifier}.json", lesson("book-" + identifier))
        sha = hashlib.sha256(file.read_bytes()).hexdigest()
        self.write("content/book-release.json", {"units": {identifier: {"lessonSHA256": sha}}})
        self.write(f"data/parsed-books/{identifier}.json", {"changed": True})
        with patch.object(audit, "validate_unit", side_effect=ValueError("Local source changed")) as private:
            with patch.object(audit, "validate_lesson") as portable:
                result = self.refresh(sources(identifier))
        private.assert_called_once()
        portable.assert_not_called()
        target = result["targets"][identifier]
        self.assertEqual(target["availability"], "unavailable")
        self.assertIn("Local source changed", target["error"])


if __name__ == "__main__":
    unittest.main()

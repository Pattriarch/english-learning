"""Pure recovery-seed binding tests; no model calls or production writes."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from coursebook_lesson_template import value_sha
from coursebook_recovery_seed import load_recovery_seed


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class RecoverySeedTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.folder = Path(temp.name)
        self.bundle = {"chapter": {"unitId": "clear-speech-3-007", "bookId": "clear-speech-3"},
                       "source": {"text": "Current exact source with corrected recognition evidence."},
                       "attachments": [{"page": 74, "sha256": "a" * 64}]}
        self.bundle["sourceSetSha256"] = value_sha(self.bundle)
        # Deliberately invalid lesson structure: this is repair input, not an
        # accepted lesson. The raw noncanonical ID must not be normalized.
        self.candidate = {"id": "clear-speech-3-007", "sections": [], "exercises": [],
            "materials": [{"id": "bad-material", "text": "Проверить содержимое."}],
            "provenance": {"unitId": "clear-speech-3-007", "bookId": "clear-speech-3"}}
        self.base_path = self.folder / "lesson-draft-1-repair-2.json"
        self.control_path = self.folder / "lesson-recovery.json"
        write_json(self.base_path, self.candidate)
        self.control = {"version": 1, "unitId": "clear-speech-3-007",
            "sourceSetSha256": self.bundle["sourceSetSha256"], "baseFile": self.base_path.name,
            "baseSha256": sha(self.base_path), "candidateSha256": value_sha(self.candidate),
            "nextDraft": 2, "findings": ["Restore the missing lesson sections and their relevant source practice.",
                {"pointId": "point-one", "exerciseId": "", "issue": "Correct the supplied material alignment before asking for independent review."}],
            "reason": "The exited draft failed complete coverage and needs a new full-candidate repair."}
        self.save()

    def save(self, control=None):
        write_json(self.control_path, self.control if control is None else control)

    def load(self, bundle=None):
        return load_recovery_seed(self.bundle if bundle is None else bundle, self.folder)

    def refresh_base(self, candidate):
        write_json(self.base_path, candidate)
        control = deepcopy(self.control)
        control["baseSha256"] = sha(self.base_path)
        control["candidateSha256"] = value_sha(candidate)
        self.save(control)

    def test_missing_control_returns_none_without_writes(self):
        self.control_path.unlink()
        snapshot = {p.name: p.read_bytes() for p in self.folder.iterdir()}
        self.assertIsNone(self.load())
        self.assertEqual(snapshot, {p.name: p.read_bytes() for p in self.folder.iterdir()})

    def test_flawed_raw_candidate_is_only_unverified_input_and_returned_unchanged(self):
        snapshot = {p.name: p.read_bytes() for p in self.folder.iterdir()}
        bundle = deepcopy(self.bundle)
        seed = self.load()
        self.assertEqual(set(seed), {"candidate", "findings", "nextDraft", "evidence"})
        self.assertEqual(seed["candidate"], self.candidate)
        self.assertEqual(seed["findings"], self.control["findings"])
        self.assertEqual(seed["nextDraft"], 2)
        self.assertEqual(seed["evidence"], {"version": 1, "status": "unverified-recovery-seed",
            "requiresIndependentReview": True, "file": "lesson-recovery.json",
            "sha256": sha(self.control_path), "unitId": self.control["unitId"],
            "sourceSetSha256": self.control["sourceSetSha256"], "baseFile": self.base_path.name,
            "baseSha256": sha(self.base_path), "candidateSha256": value_sha(self.candidate),
            "nextDraft": 2, "reason": self.control["reason"],
            "findingsSha256": value_sha(self.control["findings"])})
        self.assertNotIn("decision", seed["evidence"])
        self.assertEqual(self.bundle, bundle)
        self.assertEqual(snapshot, {p.name: p.read_bytes() for p in self.folder.iterdir()})
        seed["candidate"]["materials"][0]["text"] = "Changed returned object"
        seed["findings"][1]["issue"] = "Changed returned finding"
        self.assertEqual(self.load()["candidate"], self.candidate)
        self.assertEqual(self.load()["findings"], self.control["findings"])

    def test_existing_next_draft_and_request_are_left_to_exact_cached_call_gate(self):
        for name in ("lesson-draft-2.json", "lesson-draft-2.request.json"):
            write_json(self.folder / name, {"unrelated": "existing resume checkpoint"})
        snapshot = {p.name: p.read_bytes() for p in self.folder.iterdir()}
        self.assertEqual(self.load()["nextDraft"], 2)
        self.assertEqual(snapshot, {p.name: p.read_bytes() for p in self.folder.iterdir()})

    def test_source_set_unit_and_bundle_self_hash_all_bind(self):
        for case in ("control-source", "control-unit", "self-hash", "new-valid-source", "book-missing"):
            with self.subTest(case=case):
                bundle, control = deepcopy(self.bundle), deepcopy(self.control)
                if case == "control-source": control["sourceSetSha256"] = "0" * 64
                elif case == "control-unit": control["unitId"] = "clear-speech-3-009"
                elif case == "book-missing":
                    del bundle["chapter"]["bookId"]
                    bundle.pop("sourceSetSha256")
                    bundle["sourceSetSha256"] = value_sha(bundle)
                else:
                    bundle["attachments"][0]["sha256"] = "b" * 64
                    if case == "new-valid-source":
                        bundle.pop("sourceSetSha256")
                        bundle["sourceSetSha256"] = value_sha(bundle)
                self.save(control)
                with self.assertRaises(ValueError): self.load(bundle)

    def test_base_byte_hash_and_candidate_value_hash_are_independent(self):
        self.base_path.write_bytes(self.base_path.read_bytes() + b"\n")
        with self.assertRaisesRegex(ValueError, "file bytes changed"): self.load()
        write_json(self.base_path, self.candidate)
        control = deepcopy(self.control)
        control["candidateSha256"] = "0" * 64
        self.save(control)
        with self.assertRaisesRegex(ValueError, "value hash changed"): self.load()

    def test_foreign_or_missing_raw_provenance_cannot_be_repaired_by_relabeling(self):
        for case in ("unit", "book", "missing", "nonobject"):
            with self.subTest(case=case):
                candidate = deepcopy(self.candidate)
                if case == "unit": candidate["provenance"]["unitId"] = "clear-speech-3-009"
                elif case == "book": candidate["provenance"]["bookId"] = "great-writing-4-4"
                elif case == "missing": candidate.pop("provenance")
                else: candidate["provenance"] = []
                self.refresh_base(candidate)
                with self.assertRaisesRegex(ValueError, "provenance"): self.load()

    def test_next_draft_is_real_bounded_integer_strictly_after_raw_iteration(self):
        for value in (True, False, 2.0, "2", 1, 0, -1, 7, None):
            with self.subTest(value=value):
                control = deepcopy(self.control);control["nextDraft"] = value;self.save(control)
                with self.assertRaisesRegex(ValueError, "nextDraft"): self.load()
        for name, next_draft, valid in (("lesson-draft-2.json", 2, False),
                                      ("lesson-draft-5-repair-3.json", 6, True),
                                      ("lesson-draft-6.json", 6, False)):
            with self.subTest(name=name):
                write_json(self.folder / name, self.candidate)
                control = deepcopy(self.control);control.update(baseFile=name, nextDraft=next_draft,
                    baseSha256=sha(self.folder / name));self.save(control)
                if valid: self.assertEqual(self.load()["nextDraft"], 6)
                else:
                    with self.assertRaisesRegex(ValueError, "nextDraft"): self.load()

    def test_findings_and_reason_are_precise_bounded_exact_contracts(self):
        cases = [[], ["short"], [" " * 25], [123], [True], ["valid issue with enough characters"] * 41,
            [{"pointId": "", "exerciseId": "", "issue": "short"}],
            [{"pointId": 1, "exerciseId": "", "issue": "An issue with sufficient detail for a full repair."}],
            [{"pointId": "", "issue": "An issue with sufficient detail for a full repair."}],
            [{"pointId": "", "exerciseId": "", "issue": "An issue with sufficient detail for a full repair.", "accepted": True}]]
        for findings in cases:
            with self.subTest(findings=findings):
                control = deepcopy(self.control);control["findings"] = findings;self.save(control)
                with self.assertRaisesRegex(ValueError, "finding"): self.load()
        for reason in ("short", " " * 40, None, 30):
            with self.subTest(reason=reason):
                control = deepcopy(self.control);control["reason"] = reason;self.save(control)
                with self.assertRaisesRegex(ValueError, "reason"): self.load()

    def test_unknown_missing_fields_boolean_version_and_duplicate_json_keys_fail(self):
        for case in ("extra", "missing", "boolean-version", "wrong-version"):
            with self.subTest(case=case):
                control = deepcopy(self.control)
                if case == "extra": control["accepted"] = True
                elif case == "missing": control.pop("reason")
                else: control["version"] = True if case == "boolean-version" else 2
                self.save(control)
                with self.assertRaisesRegex(ValueError, "fields or version"): self.load()
        raw = json.dumps(self.control)
        self.control_path.write_text(raw[:-1] + ', "version": 1}', encoding="utf8")
        with self.assertRaisesRegex(ValueError, "duplicate JSON"): self.load()

    def test_paths_must_be_existing_local_draft_basenames(self):
        for name in ("../lesson-draft-1.json", "lesson.json", str(self.base_path.resolve()),
                     "lesson-draft-0.json", "lesson-draft-7.json", "lesson-draft-1-repair-4.json",
                     "lesson-draft-2.json", "lesson-draft-1.json:stream", None):
            with self.subTest(name=name):
                control = deepcopy(self.control);control["baseFile"] = name;self.save(control)
                with self.assertRaises(ValueError): self.load()

    def test_control_and_base_must_be_regular_json_objects(self):
        for raw in (b"[]", b"null", b"{invalid", b"\xff"):
            with self.subTest(raw=raw):
                self.control_path.write_bytes(raw)
                with self.assertRaises(ValueError): self.load()
        self.save()
        self.base_path.write_text("[]", encoding="utf8")
        with self.assertRaises(ValueError): self.load()

    def test_every_control_byte_and_semantic_recovery_change_gets_new_evidence(self):
        original = self.load()["evidence"]
        self.control_path.write_bytes(self.control_path.read_bytes() + b"\n")
        whitespace = self.load()["evidence"]
        self.assertNotEqual(whitespace["sha256"], original["sha256"])
        self.assertEqual(whitespace["findingsSha256"], original["findingsSha256"])
        control = deepcopy(self.control)
        control["findings"][0] += " Also restore the actual writing purpose."
        self.save(control)
        changed = self.load()["evidence"]
        self.assertNotEqual(changed["sha256"], original["sha256"])
        self.assertNotEqual(changed["findingsSha256"], original["findingsSha256"])
        self.assertEqual(changed["candidateSha256"], original["candidateSha256"])


if __name__ == "__main__":
    unittest.main()

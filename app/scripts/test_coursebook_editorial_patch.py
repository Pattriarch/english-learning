"""Offline editorial-proposal binding and field-scope regressions."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from coursebook_editorial_patch import _allowed, apply_changes, load_patch
from coursebook_lesson_template import value_sha


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class EditorialPatchTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.folder = Path(temp.name)
        self.bundle = {"chapter": {"unitId": "clear-speech-3-001"},
                       "source": {"text": "Exact chapter and checked recordings."}}
        self.bundle["sourceSetSha256"] = value_sha(self.bundle)
        self.base = {"id": "book-clear-speech-3-001", "title": "Название", "level": "A2",
                     "subtitle": "Подзаголовок", "goal": "Понятная цель", "formula": "Полезное правило",
                     "sections": [{"title": "Правило", "body": "Исходное объяснение."}],
                     "examples": [{"en": "I sent the package.", "ru": "Я отправил посылку.",
                                   "why": "Объяснение выбора."}],
                     "exercises": [{"id": "e01", "kind": "write", "prompt": "Напишите ответ.",
                                    "context": "Реальная ситуация.", "hint": "Подумайте об адресате.",
                                    "explanation": "Выбор определяется целью.",
                                    "answers": ["I sent the package this morning."]}],
                     "materials": [{"id": "audio-one", "text": "Immutable checked transcript."}],
                     "studyPlan": {"stages": [{"id": "input", "purpose": "Прочитайте объяснение.",
                         "exerciseIds": ["e01"], "minutes": 20}]},
                     "provenance": {"sourceCoverage": [{"pointId": "point-one"}]}}
        self.base_path = self.folder / "lesson-draft-1-repair-2.json"
        self.patch_path = self.folder / "editorial-patch.json"
        self.save_base()
        self.proposal = {"version": 1, "sourceSetSha256": self.bundle["sourceSetSha256"],
                         "unitId": self.bundle["chapter"]["unitId"], "baseFile": self.base_path.name,
                         "baseSha256": hashlib.sha256(self.base_path.read_bytes()).hexdigest(),
                         "baseCandidateSha256": value_sha(self.base),
                         "changes": [self.change(["exercises", 0, "prompt"],
                            "Напишите ответ.", "Напишите адресату 20–30 слов и объясните выбор.")]}

    def change(self, path, before, after):
        return {"path": path, "before": before, "after": after,
                "reason": "Уточнить задание и сохранить исходную учебную цель."}

    def save_base(self):
        write_json(self.base_path, self.base)

    def save_patch(self, value=None):
        write_json(self.patch_path, self.proposal if value is None else value)

    def test_missing_patch_returns_none_without_creating_any_file(self):
        before = list(self.folder.iterdir())
        self.assertIsNone(load_patch(self.bundle, self.folder))
        self.assertEqual(list(self.folder.iterdir()), before)

    def test_allowed_unicode_text_changes_return_exact_proposal_and_evidence_without_writes(self):
        changes = [self.change(["subtitle"], self.base["subtitle"], "Уточнённый подзаголовок"),
                   self.change(["goal"], self.base["goal"], "Более точная цель урока"),
                   self.change(["formula"], self.base["formula"], "Размеченное правило /ɪd/"),
                   self.change(["studyPlan", "stages", 0, "purpose"],
                               "Прочитайте объяснение.", "Сначала сравните примеры, затем проверьте правило."),
                   self.change(["sections", 0, "body"], self.base["sections"][0]["body"], "Пояснение смысла и ограничения."),
                   *[self.change(["examples", 0, key], self.base["examples"][0][key],
                                 "Полезное уточнение «выбора» — " + key) for key in ("en", "ru", "why")],
                   *[self.change(["exercises", 0, key], self.base["exercises"][0][key],
                                 "Конкретное уточнение задания — " + key)
                     for key in ("prompt", "context", "hint", "explanation")],
                   self.change(["exercises", 0, "answers", 0], self.base["exercises"][0]["answers"][0],
                               "Message: I sent the package this morning.\nReflection: I clarified the delivery time.")]
        self.proposal["changes"] = changes
        self.save_patch()
        snapshots = {path.name: path.read_bytes() for path in self.folder.iterdir()}
        original_bundle = deepcopy(self.bundle)
        candidate, evidence = load_patch(self.bundle, self.folder)
        expected = deepcopy(self.base)
        for change in changes:
            node = expected
            for key in change["path"][:-1]:
                node = node[key]
            node[change["path"][-1]] = change["after"]
        self.assertEqual(candidate, expected)
        self.assertEqual(evidence, {"file": "editorial-patch.json",
            "sha256": hashlib.sha256(snapshots["editorial-patch.json"]).hexdigest(),
            "baseFile": self.base_path.name, "baseSha256": self.proposal["baseSha256"],
            "candidateSha256": value_sha(expected),
            "changes": [{"path": c["path"], "reason": c["reason"]} for c in changes]})
        self.assertEqual(self.bundle, original_bundle)
        self.assertEqual({path.name: path.read_bytes() for path in self.folder.iterdir()}, snapshots)
        self.assertEqual(load_patch(self.bundle, self.folder), (candidate, evidence))

    def test_source_unit_and_current_bundle_self_hash_are_all_bound(self):
        self.save_patch()
        for case in ("source-set", "unit", "bundle-self-hash"):
            with self.subTest(case=case):
                bundle, proposal = deepcopy(self.bundle), deepcopy(self.proposal)
                if case == "source-set":
                    proposal["sourceSetSha256"] = "0" * 64
                elif case == "unit":
                    proposal["unitId"] = "clear-speech-3-002"
                else:
                    bundle["source"]["text"] += " changed"
                self.save_patch(proposal)
                with self.assertRaisesRegex(ValueError, "source|unit"):
                    load_patch(bundle, self.folder)

    def test_exact_base_bytes_and_parsed_candidate_hash_are_independently_checked(self):
        self.save_patch()
        self.base_path.write_bytes(self.base_path.read_bytes() + b"\n")
        with self.assertRaisesRegex(ValueError, "base file bytes changed"):
            load_patch(self.bundle, self.folder)
        self.save_base()
        proposal = deepcopy(self.proposal)
        proposal["baseCandidateSha256"] = "0" * 64
        self.save_patch(proposal)
        with self.assertRaisesRegex(ValueError, "base candidate value hash changed"):
            load_patch(self.bundle, self.folder)

    def test_noncanonical_base_id_is_rejected_even_with_refreshed_hashes(self):
        self.base["id"] = "clear-speech-3-001"
        self.save_base()
        self.proposal["baseSha256"] = hashlib.sha256(self.base_path.read_bytes()).hexdigest()
        self.proposal["baseCandidateSha256"] = value_sha(self.base)
        self.save_patch()
        with self.assertRaisesRegex(ValueError, "canonical book-unit ID"):
            load_patch(self.bundle, self.folder)

    def test_identifiers_materials_metadata_arrays_and_section_titles_are_forbidden(self):
        paths = [["id"], ["level"], ["title"], ["provenance"],
                 ["provenance", "sourceCoverage", 0, "pointId"],
                 ["materials", 0, "text"], ["sections", 0, "title"],
                 ["examples"], ["exercises", 0, "id"], ["exercises", 0, "kind"],
                 ["studyPlan", "stages", 0, "id"], ["studyPlan", "stages", 0, "exerciseIds"],
                 ["studyPlan", "stages", 0, "minutes"], ["studyPlan", "stages"],
                 ["exercises", 0, "answers"], ["sourceCoverage", 0, "point"]]
        for path in paths:
            with self.subTest(path=path):
                proposal = deepcopy(self.proposal)
                proposal["changes"][0]["path"] = path
                self.save_patch(proposal)
                with self.assertRaisesRegex(ValueError, "forbidden editorial field"):
                    load_patch(self.bundle, self.folder)

    def test_indices_must_be_real_nonnegative_in_bounds_integers_and_leaf_must_exist(self):
        for index in (-1, True, False, 0.0, "0", 5):
            for path in (["exercises", index, "prompt"], ["exercises", 0, "answers", index]):
                with self.subTest(path=path):
                    proposal = deepcopy(self.proposal)
                    proposal["changes"][0]["path"] = path
                    self.save_patch(proposal)
                    with self.assertRaises(ValueError):
                        load_patch(self.bundle, self.folder)
        self.base["exercises"][0]["hint"] = None
        self.save_base()
        self.proposal["baseSha256"] = hashlib.sha256(self.base_path.read_bytes()).hexdigest()
        self.proposal["baseCandidateSha256"] = value_sha(self.base)
        self.proposal["changes"][0]["path"] = ["exercises", 0, "hint"]
        self.save_patch()
        with self.assertRaisesRegex(ValueError, "existing string leaves"):
            load_patch(self.bundle, self.folder)

    def test_before_after_reason_and_duplicate_changes_are_strict(self):
        for case in ("before", "empty-after", "same-after", "nonstring-after", "reason", "duplicate"):
            with self.subTest(case=case):
                proposal = deepcopy(self.proposal)
                change = proposal["changes"][0]
                if case == "before":
                    change["before"] += " altered"
                elif case == "empty-after":
                    change["after"] = " \n\t "
                elif case == "same-after":
                    change["after"] = change["before"]
                elif case == "nonstring-after":
                    change["after"] = ["replacement"]
                elif case == "reason":
                    change["reason"] = " too short "
                else:
                    proposal["changes"].append(deepcopy(change))
                self.save_patch(proposal)
                with self.assertRaises(ValueError):
                    load_patch(self.bundle, self.folder)

    def test_path_traversal_missing_base_and_unexpected_contract_fields_fail(self):
        for base_name in ("../lesson-draft-1-repair-2.json", str(self.base_path.resolve()),
                          "lesson.json", "lesson-draft-1-repair-4.json", "lesson-draft-2.json"):
            with self.subTest(base_name=base_name):
                proposal = deepcopy(self.proposal)
                proposal["baseFile"] = base_name
                self.save_patch(proposal)
                with self.assertRaises(ValueError):
                    load_patch(self.bundle, self.folder)
        for case in ("boolean-version", "extra-proposal", "extra-change", "empty-changes", "bad-path"):
            with self.subTest(case=case):
                proposal = deepcopy(self.proposal)
                if case == "boolean-version":
                    proposal["version"] = True
                elif case == "extra-proposal":
                    proposal["accepted"] = True
                elif case == "extra-change":
                    proposal["changes"][0]["operation"] = "replace"
                elif case == "empty-changes":
                    proposal["changes"] = []
                else:
                    proposal["changes"][0]["path"] = "exercises.0.prompt"
                self.save_patch(proposal)
                with self.assertRaises(ValueError):
                    load_patch(self.bundle, self.folder)

    def test_changed_proposal_bytes_and_result_cannot_reuse_old_evidence_hashes(self):
        self.save_patch()
        candidate, evidence = load_patch(self.bundle, self.folder)
        proposal = deepcopy(self.proposal)
        proposal["changes"][0]["after"] += " Затем сохраните запись."
        self.save_patch(proposal)
        changed, new_evidence = load_patch(self.bundle, self.folder)
        self.assertNotEqual(new_evidence["sha256"], evidence["sha256"])
        self.assertNotEqual(new_evidence["candidateSha256"], evidence["candidateSha256"])
        self.assertEqual(new_evidence["candidateSha256"], value_sha(changed))
        self.assertNotEqual(candidate, changed)
        # A proposal is never acceptance; the independent review must bind to
        # the new candidate and the caller compares persisted evidence exactly.
        self.assertNotIn("decision", new_evidence)

    def prepare_original_material(self):
        self.bundle["approvedMaterials"] = deepcopy(self.base["materials"])
        self.bundle["sourceSetSha256"] = value_sha({key: value for key, value in self.bundle.items()
                                                  if key != "sourceSetSha256"})
        self.base["materials"].append({"id": "original-grid-key", "title": "Coordinate key",
            "kind": "reference", "text": "B1: Selling and White.",
            "source": "Оригинальный ключ координатной карты"})
        self.save_base()
        self.proposal.update({"sourceSetSha256": self.bundle["sourceSetSha256"],
            "baseSha256": hashlib.sha256(self.base_path.read_bytes()).hexdigest(),
            "baseCandidateSha256": value_sha(self.base)})
        self.proposal["changes"] = [self.change(["materials", 1, "text"],
                                                "B1: Selling and White.", "B1: White and Witt.")]
        self.save_patch()

    def test_direct_original_text_fix_preserves_supplied_material_and_all_files(self):
        self.prepare_original_material()
        original_base, original_bundle = deepcopy(self.base), deepcopy(self.bundle)
        before = {p.name: p.read_bytes() for p in self.folder.iterdir()}
        candidate, evidence = load_patch(self.bundle, self.folder)
        self.assertEqual(candidate["materials"][1]["text"], "B1: White and Witt.")
        self.assertEqual(candidate["materials"][0], original_base["materials"][0])
        self.assertEqual(candidate["materials"][1]["source"], original_base["materials"][1]["source"])
        self.assertEqual(evidence["candidateSha256"], value_sha(candidate))
        self.assertEqual((self.base, self.bundle), (original_base, original_bundle))
        self.assertEqual({p.name: p.read_bytes() for p in self.folder.iterdir()}, before)
        self.assertFalse(_allowed(["materials", 1, "text"]), "automated editor must retain its narrower scope")

    def test_pure_apply_uses_exact_base_and_does_not_read_or_replace_raw_draft(self):
        self.prepare_original_material()
        original = self.base_path.read_bytes()
        base = deepcopy(self.base)
        base["exercises"][0]["context"] = "A complete candidate from an independently bound historical review."
        result = apply_changes(base, self.bundle, self.proposal["changes"])
        self.assertEqual(result["exercises"], base["exercises"])
        self.assertEqual(self.base_path.read_bytes(), original)
        stale = deepcopy(self.proposal["changes"])
        stale[0]["before"] = "A different rejected draft."
        with self.assertRaisesRegex(ValueError, "before text"):
            apply_changes(base, self.bundle, stale)
        invalid_bundle = deepcopy(self.bundle)
        invalid_bundle["source"]["text"] += " altered"
        with self.assertRaisesRegex(ValueError, "source bundle"):
            apply_changes(base, invalid_bundle, self.proposal["changes"])

    def test_recording_id_cannot_be_relabelled_as_original_for_editing(self):
        self.prepare_original_material()
        base = deepcopy(self.base)
        base["materials"][0].update({"kind": "reference", "source": "Original course adaptation"})
        changes = [self.change(["materials", 0, "text"], base["materials"][0]["text"], "Changed recorded words.")]
        with self.assertRaisesRegex(ValueError, "forbidden editorial field"):
            apply_changes(base, self.bundle, changes)

    def test_original_material_assets_unknown_metadata_and_source_labels_fail_closed(self):
        self.prepare_original_material()
        for key, value in [("audioFile", "recording.mp3"), ("imageFile", "map.svg"),
                           ("sourceURL", "https://example.org/transcript"), ("audioSourceURL", "source.mp3"),
                           ("externalReference", "source-document"), ("kind", "image"),
                           ("source", "Supplied chapter transcript"),
                           ("source", "Original transcript from the supplied book"),
                           ("source", "Оригинальный текст из учебника"), ("source", "Unknown source")]:
            with self.subTest(key=key, value=value):
                base = deepcopy(self.base)
                base["materials"][1][key] = value
                with self.assertRaisesRegex(ValueError, "forbidden editorial field"):
                    apply_changes(base, self.bundle, self.proposal["changes"])

    def test_original_text_scope_rejects_material_identity_kind_arrays_and_duplicate_ids(self):
        self.prepare_original_material()
        for path in [["materials"], ["materials", 1], ["materials", 1, "id"],
                     ["materials", 1, "source"], ["materials", 1, "kind"],
                     ["materials", 1, "title"], ["materials", True, "text"],
                     ["materials", -1, "text"], ["materials", 2, "text"]]:
            with self.subTest(path=path):
                changes = deepcopy(self.proposal["changes"])
                changes[0]["path"] = path
                with self.assertRaisesRegex(ValueError, "forbidden editorial field"):
                    apply_changes(self.base, self.bundle, changes)
        base = deepcopy(self.base)
        base["materials"].append(deepcopy(base["materials"][1]))
        with self.assertRaisesRegex(ValueError, "forbidden editorial field"):
            apply_changes(base, self.bundle, self.proposal["changes"])

    def test_original_english_material_uses_same_direct_scope(self):
        self.prepare_original_material()
        for source in ("Original course adaptation", "Original pronunciation reference created for this adaptation"):
            with self.subTest(source=source):
                base = deepcopy(self.base)
                base["materials"][1]["source"] = source
                result = apply_changes(base, self.bundle, self.proposal["changes"])
                self.assertEqual(result["materials"][1]["text"], "B1: White and Witt.")

    def test_direct_source_caption_can_remove_false_ui_claim_without_changing_authorship(self):
        self.prepare_original_material()
        base = deepcopy(self.base)
        base["materials"][1]["source"] = "Оригинальный сценарий диктанта; приложение обязано скрывать текст до отправки"
        after = "Оригинальный сценарий диктанта"
        change = self.change(["materials", 1, "source"], base["materials"][1]["source"], after)
        result = apply_changes(base, self.bundle, [change])
        self.assertEqual(result["materials"][1]["source"], after)
        self.assertEqual(result["materials"][1]["text"], base["materials"][1]["text"])
        self.assertEqual(result["materials"][0], self.bundle["approvedMaterials"][0])
        self.assertFalse(_allowed(change["path"]))

    def test_caption_edit_cannot_claim_a_new_external_source_or_strip_original_authorship(self):
        self.prepare_original_material()
        for after in ("NASA original recording", "Original NASA recording", "Original transcript from the textbook", "Approved source",
                      "Запись профессионального диктора", "Original source", "https://example.org"):
            change = self.change(["materials", 1, "source"], self.base["materials"][1]["source"], after)
            with self.subTest(after=after), self.assertRaisesRegex(ValueError, "forbidden editorial field"):
                apply_changes(self.base, self.bundle, [change])

    def test_direct_ui_warning_correction_preserves_other_provenance_and_warning_count(self):
        base = deepcopy(self.base)
        base["provenance"] = {"warnings": ["The application must lock all transcripts.",
            "Audio was not inspected."], "sourceImages": [{"sha256": "a" * 64}]}
        path = ["provenance", "warnings", 0]
        change = self.change(path, base["provenance"]["warnings"][0],
            "The application collapses transcripts; the learner may reveal them voluntarily.")
        result = apply_changes(base, self.bundle, [change])
        self.assertEqual(result["provenance"]["warnings"], [change["after"], "Audio was not inspected."])
        self.assertEqual(result["provenance"]["sourceImages"], base["provenance"]["sourceImages"])
        self.assertFalse(_allowed(path))
        bad = self.change(["provenance", "sourceImages", 0, "sha256"], "a" * 64, "b" * 64)
        with self.assertRaisesRegex(ValueError, "forbidden editorial field"):
            apply_changes(base, self.bundle, [bad])

    def test_authored_phonetic_warning_is_correctable_without_changing_source_evidence(self):
        base = deepcopy(self.base)
        base["provenance"] = {"warnings": ["Pure merges with peer in the chosen model."],
            "approvedAudio": [{"audioSha256": "a" * 64}]}
        change = self.change(["provenance", "warnings", 0], base["provenance"]["warnings"][0],
            "The model distinguishes pure /pjʊr/ and peer /pɪr/; no merger is asserted.")
        result = apply_changes(base, self.bundle, [change])
        self.assertEqual(result["provenance"]["approvedAudio"], base["provenance"]["approvedAudio"])
        self.assertEqual(len(result["provenance"]["warnings"]), 1)
        self.assertFalse(_allowed(change["path"]))


if __name__ == "__main__":
    unittest.main()

"""Bounded stimulus appends cannot rewrite source materials or existing tasks."""
from copy import deepcopy
import unittest

from coursebook_material_additions import apply_additions


class MaterialAdditionsTests(unittest.TestCase):
    def setUp(self):
        self.base = {"materials": [{"id": "approved", "audioFile": "/book-recordings/one.mp3", "text": "Exact supplied transcript"}],
                     "exercises": [{"id": "e1", "materialIds": ["approved"], "prompt": "Preserve full output."},
                                   {"id": "e2", "prompt": "Preserve the second task."}],
                     "studyPlan": {"stages": [{"id": "input", "exerciseIds": ["e1", "e2"]}]},
                     "provenance": {"sourceHash": "exact-source", "sourceCoverage": ["retained"]}}
        self.bundle = {"approvedMaterials": deepcopy(self.base["materials"]) + [{"id": "not-yet-linked-approved"}]}
        self.additions = {"beforeMaterialIds": ["approved"], "items": [{
            "material": {"id": "original-listening", "title": "New listening stimulus", "kind": "listening",
                         "text": "There is one notebook on my desk. Two folders are beside the lamp.",
                         "source": "Original course adaptation", "inputSkill": "listening-script"},
            "exerciseLinks": [{"exerciseId": "e1", "beforeMaterialIds": ["approved"]}],
            "reason": "Supply an original unrevealed listening stimulus for the existing number interpretation task."}]}

    def test_exact_append_preserves_all_existing_content_and_arguments(self):
        original, bundle, additions = deepcopy(self.base), deepcopy(self.bundle), deepcopy(self.additions)
        result = apply_additions(self.base, self.bundle, self.additions)
        self.assertEqual(self.base, original)
        self.assertEqual(self.bundle, bundle)
        self.assertEqual(self.additions, additions)
        self.assertEqual(result["materials"][:-1], original["materials"])
        self.assertEqual(result["provenance"], original["provenance"])
        self.assertEqual(result["studyPlan"], original["studyPlan"])
        self.assertEqual(result["exercises"][1], original["exercises"][1])
        self.assertEqual(result["exercises"][0], {**original["exercises"][0], "materialIds": ["approved", "original-listening"]})
        result["materials"][-1]["text"] = "changed copy"
        self.assertEqual(self.additions, additions)

    def test_two_stimuli_can_link_disjoint_existing_tasks_with_missing_empty_refs(self):
        second = deepcopy(self.additions["items"][0])
        second["material"]["id"] = "original-second"
        second["exerciseLinks"] = [{"exerciseId": "e2", "beforeMaterialIds": []}]
        self.additions["items"].append(second)
        result = apply_additions(self.base, self.bundle, self.additions)
        self.assertEqual(result["exercises"][1]["materialIds"], ["original-second"])
        self.assertEqual(len(result["materials"]), 3)

    def test_protected_source_and_asset_fields_are_rejected(self):
        for field, value in (("audioFile", "/book-recordings/fake.mp3"), ("sourceUrl", "https://example.com"),
                             ("image", "asset.png"), ("kind", "reference"), ("inputSkill", "native-recording"),
                             ("source", "Original source textbook recording"), ("text", "Listen at /assets/private.mp3")):
            with self.subTest(field=field):
                additions = deepcopy(self.additions)
                additions["items"][0]["material"][field] = value
                with self.assertRaises(ValueError): apply_additions(self.base, self.bundle, additions)

    def test_existing_or_approved_identity_cannot_be_replaced_or_duplicated(self):
        for material_id in ("approved", "not-yet-linked-approved", "e1", "../escape", ""):
            additions = deepcopy(self.additions)
            additions["items"][0]["material"]["id"] = material_id
            with self.assertRaises(ValueError): apply_additions(self.base, self.bundle, additions)
        additions = deepcopy(self.additions)
        additions["items"].append(deepcopy(additions["items"][0]))
        with self.assertRaises(ValueError): apply_additions(self.base, self.bundle, additions)

    def test_exact_before_orders_and_existing_link_scope_are_required(self):
        for case in ("materials-before", "links-before", "unknown-task", "duplicate-task", "extra-key"):
            additions = deepcopy(self.additions)
            if case == "materials-before": additions["beforeMaterialIds"] = []
            if case == "links-before": additions["items"][0]["exerciseLinks"][0]["beforeMaterialIds"] = []
            if case == "unknown-task": additions["items"][0]["exerciseLinks"][0]["exerciseId"] = "invented"
            if case == "duplicate-task": additions["items"][0]["exerciseLinks"] *= 2
            if case == "extra-key": additions["items"][0]["exerciseLinks"][0]["kind"] = "write"
            with self.subTest(case=case), self.assertRaises(ValueError): apply_additions(self.base, self.bundle, additions)

    def test_bounded_count_text_and_reason_are_required(self):
        for case in ("zero", "three", "short-text", "long-text", "short-reason", "no-links", "five-links", "chapter-limit"):
            additions, base = deepcopy(self.additions), deepcopy(self.base)
            if case == "zero": additions["items"] = []
            if case == "three": additions["items"] *= 3
            if case == "short-text": additions["items"][0]["material"]["text"] = "Too short"
            if case == "long-text": additions["items"][0]["material"]["text"] = "a" * 12001
            if case == "short-reason": additions["items"][0]["reason"] = "Just add."
            if case == "no-links": additions["items"][0]["exerciseLinks"] = []
            if case == "five-links": additions["items"][0]["exerciseLinks"] *= 5
            if case == "chapter-limit":
                base["materials"] += [{"id": f"existing-{n}"} for n in range(29)]
                additions["beforeMaterialIds"] = [m["id"] for m in base["materials"]]
            with self.subTest(case=case), self.assertRaises(ValueError): apply_additions(base, self.bundle, additions)

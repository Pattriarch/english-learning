"""Offline parsing and failure-closed depth-to-field mapping tests."""
from copy import deepcopy
from unittest.mock import patch
import unittest

import coursebook_depth_edits as edits
import coursebook_lesson_template as template
from test_coursebook_lesson_template import fixture


class DepthEditTests(unittest.TestCase):
    def test_no_findings_returns_empty_without_changing_input(self):
        lesson, _ = fixture()
        original = deepcopy(lesson)
        self.assertEqual(edits.depth_edit_findings(lesson), [])
        self.assertEqual(lesson, original)

    def test_real_count_deficits_map_to_exact_existing_leaves(self):
        lesson, _ = fixture()
        for key in ("subtitle", "goal", "formula"):
            lesson[key] = "Мало"
        for key in ("en", "ru", "why"):
            lesson["examples"][0][key] = "x"
        for key in ("prompt", "context", "hint", "explanation"):
            lesson["exercises"][0][key] = "x"
        expected = [[key] for key in ("subtitle", "goal", "formula")]
        expected += [["examples", 0, key] for key in ("en", "ru", "why")]
        expected += [["exercises", 0, key] for key in ("prompt", "context", "hint", "explanation")]
        original = deepcopy(lesson)
        diagnostics = template.lesson_depth_findings(lesson)
        result = edits.depth_edit_findings(lesson)
        self.assertEqual([r["path"] for r in result], expected)
        self.assertEqual([r["issue"] for r in result], diagnostics)
        self.assertEqual(lesson, original)

    def test_section_characters_and_words_combine_and_duplicate_example_issue_is_kept_once(self):
        lesson, _ = fixture()
        lesson["sections"][0]["body"] = "Короткое пояснение."
        lesson["examples"][1]["why"] = "Причина."
        diagnostics = template.lesson_depth_findings(lesson)
        with patch.object(template, "lesson_depth_findings", return_value=diagnostics + diagnostics):
            result = edits.depth_edit_findings(lesson)
        self.assertEqual(result, [
            {"path": ["sections", 0, "body"], "issue": "\n".join(diagnostics[:2])},
            {"path": ["examples", 1, "why"], "issue": diagnostics[2]}])

    def test_named_word_blocks_and_ranges_are_preserved_in_one_answer_finding(self):
        lesson, _ = fixture()
        exercise = lesson["exercises"][1]
        exercise["prompt"] = "Напишите сообщение адресату: Message: 20–30 слов; Reflection: 10–15 слов. Объяснение вынесите отдельно."
        exercise["answers"] = ["Message:\nPlease send the invoice.\nReflection:\nI asked politely."]
        diagnostics = template.lesson_depth_findings(lesson)
        result = edits.depth_edit_findings(lesson)
        self.assertEqual(result, [{"path": ["exercises", 1, "answers", 0], "issue": "\n".join(diagnostics)}])
        self.assertIn("block Message has 4 words; required 20–30", result[0]["issue"])
        self.assertIn("block Reflection has 3 words; required 10–15", result[0]["issue"])

    def test_missing_recording_maps_to_prompt_and_combines_with_prompt_depth(self):
        lesson, _ = fixture()
        lesson["exercises"][15]["prompt"] = "Скажите 10–30 слов."
        diagnostics = template.lesson_depth_findings(lesson)
        self.assertEqual(edits.depth_edit_findings(lesson), [
            {"path": ["exercises", 15, "prompt"], "issue": "\n".join(diagnostics)}])
        self.assertIn("AUDIO RECORDING", diagnostics[-1])

    def test_noneditable_title_requires_full_repair_without_widening_whitelist(self):
        lesson, _ = fixture()
        lesson["title"] = "Мало"
        with self.assertRaisesRegex(ValueError, "outside the editorial whitelist"):
            edits.depth_edit_findings(lesson)

    def test_unknown_schema_coverage_material_and_malformed_diagnostics_fail_closed(self):
        lesson, _ = fixture()
        for diagnostic in ("Unknown diagnostic", "provenance.sourceCoverage: missing point",
                "materials[0].text: incomplete material", "exercises: invalid array length",
                "sections[0].title: 1 characters; requires at least 5 substantive characters.",
                "examples[0].why: new unrecognized rule",
                "exercises[1](e2).answers[0]: imaginary issue; provide a natural complete answer meeting the actual task and all applicable ranges."):
            with self.subTest(diagnostic=diagnostic):
                with patch.object(template, "lesson_depth_findings", return_value=[diagnostic]):
                    with self.assertRaises(ValueError): edits.depth_edit_findings(lesson)
        for value in (None, {}, [None]):
            with patch.object(template, "lesson_depth_findings", return_value=value):
                with self.assertRaises(ValueError): edits.depth_edit_findings(lesson)

    def test_stale_counts_wrong_ids_and_nonexistent_paths_fail_closed(self):
        lesson, _ = fixture()
        for diagnostic in (
            "subtitle: 1 characters; requires at least 25 substantive characters.",
            "examples[99].why: 1 characters; requires at least 90 substantive characters.",
            "exercises[0](other-id).prompt: 1 characters; requires at least 45 substantive characters.",
            "exercises[0](e1).answers[9]: reference-answer label Message is missing; provide a natural complete answer meeting the actual task and all applicable ranges.",
            "exercises[-1](e1).prompt: 1 characters; requires at least 45 substantive characters."):
            with self.subTest(diagnostic=diagnostic):
                with patch.object(template, "lesson_depth_findings", return_value=[diagnostic]):
                    with self.assertRaises(ValueError): edits.depth_edit_findings(lesson)

    def test_missing_or_wrong_type_text_leaf_never_creates_a_patch_path(self):
        for case in ("missing", "list", "none"):
            lesson, _ = fixture()
            if case == "missing": del lesson["examples"][0]["why"]
            else: lesson["examples"][0]["why"] = [] if case == "list" else None
            with self.subTest(case=case):
                with patch.object(template, "lesson_depth_findings", return_value=[
                        "examples[0].why: 1 characters; requires at least 90 substantive characters."]):
                    with self.assertRaises(ValueError): edits.depth_edit_findings(lesson)
        lesson, _ = fixture()
        lesson["sections"][0]["body"] = None
        with self.assertRaisesRegex(ValueError, "malformed lesson"):
            edits.depth_edit_findings(lesson)


if __name__ == "__main__":
    unittest.main()

from copy import deepcopy
from pathlib import Path
import argparse
import tempfile
import unittest
from unittest.mock import patch

import build_baseline_references as builder
import apply_baseline_reference_corrections as editor
from test_build_baseline_references import lesson, answer


class EditorialCorrectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = Path(self.temp.name)
        self.data = self.app / "data"
        for name in builder.COURSES:
            builder.atomic_json(self.app / "content/courses" / name, [lesson()] if name == builder.COURSES[0] else [])
        self.plan = builder.collect_inventory(self.app)
        builder.atomic_json(self.data / "baseline-reference-inventory.json", self.plan)
        self.unit = self.plan["units"][0]
        self.before = answer(self.unit)
        self.args = argparse.Namespace(app=self.app, data=self.data)
        builder.save_patch(self.args, self.unit, self.before)
        builder.apply_ready(self.args, self.plan, {self.unit["lessonId"]: self.before})
        after = deepcopy(self.before["exercises"][0])
        after["answers"] = [after["answers"][0].replace("Maya", "Nora")]
        after["explanation"] += " Имя Нора заменяет прежнее имя в этом варианте."
        self.entry = {"lessonId": self.unit["lessonId"], "sourceHash": self.unit["sourceHash"],
                      "reason": "Точный редакторский вариант", "beforePatchSHA256": builder.digest(self.before),
                      "changes": [{"exerciseId": "e4", "before": self.before["exercises"][0], "after": after}]}
        self.manifest = self.data / "baseline-reference-editorial-corrections.json"
        builder.atomic_json(self.manifest, {"version": 1, "corrections": [self.entry]})
        self.course = self.app / "content/courses" / builder.COURSES[0]
        self.cache = self.data / "baseline-reference-patches" / (self.unit["lessonId"] + ".json")

    def test_exact_edit_is_idempotent_and_preserves_question(self):
        initial = builder.read(self.course)[0]
        self.assertEqual(editor.apply_corrections(self.app)["changedFiles"], 2)
        self.assertEqual(builder.read(self.course)[0], initial)
        editor.apply_corrections(self.app, apply=True)
        current = builder.read(self.course)[0]
        self.assertEqual(builder.source_hash(current, self.unit["targetIds"]), self.unit["sourceHash"])
        self.assertIn("Nora", current["exercises"][1]["answers"][0])
        saved = self.course.read_bytes(), self.cache.read_bytes()
        self.assertEqual(editor.apply_corrections(self.app, apply=True)["changedFiles"], 0)
        self.assertEqual(saved, (self.course.read_bytes(), self.cache.read_bytes()))

    def test_concurrent_published_reference_rejects_every_write(self):
        data = builder.read(self.course)
        data[0]["exercises"][1]["explanation"] = "Ручное исправление редактора"
        builder.atomic_json(self.course, data)
        before = self.course.read_bytes(), self.cache.read_bytes()
        with self.assertRaisesRegex(ValueError, "Concurrent published"):
            editor.apply_corrections(self.app, apply=True)
        self.assertEqual(before, (self.course.read_bytes(), self.cache.read_bytes()))

    def test_changed_question_rejects_edit(self):
        data = builder.read(self.course)
        data[0]["exercises"][1]["prompt"] += " Новый вопрос."
        builder.atomic_json(self.course, data)
        with self.assertRaisesRegex(ValueError, "Source changed"):
            editor.apply_corrections(self.app, apply=True)

    def test_changed_cache_cannot_be_blessed_by_new_checksum(self):
        data = builder.read(self.cache)
        data["patch"]["exercises"][0]["assumptions"].append("Новая непроверенная предпосылка.")
        data["patchSHA256"] = builder.digest(data["patch"])
        builder.atomic_json(self.cache, data)
        with self.assertRaisesRegex(ValueError, "Concurrent cache"):
            editor.apply_corrections(self.app, apply=True)

    def test_resume_after_interruption_between_atomic_files(self):
        original_write = editor.atomic_json
        calls = 0

        def interrupted(path, value):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("simulated interruption")
            return original_write(path, value)

        with patch.object(editor, "atomic_json", side_effect=interrupted):
            with self.assertRaises(OSError):
                editor.apply_corrections(self.app, apply=True)
        self.assertIn("Maya", builder.read(self.course)[0]["exercises"][1]["answers"][0])
        editor.apply_corrections(self.app, apply=True)
        self.assertIn("Nora", builder.read(self.course)[0]["exercises"][1]["answers"][0])
        self.assertEqual(len(builder.read(self.cache)["editorialCorrections"]), 1)


if __name__ == "__main__":
    unittest.main()

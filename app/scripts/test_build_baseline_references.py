"""References must match immutable questions and never overwrite concurrent work."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

import build_baseline_references as b


EXPLANATION = """Иллюстративный образец показывает, как представить двух вымышленных соседей и связать сведения о них в понятное сообщение. Имена служат только примером и не описывают реальных людей. В первой части назван человек, затем указаны его занятие и местонахождение. Отрицание относится к текущему месту, поэтому оно не противоречит профессии. Краткие предложения помогают заметить согласование подлежащего и формы глагола. В собственном ответе допустимы другие имена, города и занятия, если читателю понятно, кто действует и какое утверждение отрицается. Проверять нужно смысловые связи, а не буквальное совпадение с показанным текстом."""


def lesson(identifier="test-neighbours"):
    return {"id": identifier, "level": "A1", "title": "Соседи", "sections": [{"title": "Be", "body": "Исходная теория"}],
            "exercises": [{"id": "e1", "kind": "translate", "prompt": "Он дома.", "context": "", "answers": ["He is at home."], "hint": "be", "explanation": "Исходный разбор"},
                          {"id": "e4", "kind": "write", "prompt": "Представьте двух вымышленных соседей.",
                           "context": "Напишите 3–5 полных предложений.", "answers": [], "hint": "Полные предложения", "explanation": "Старый общий разбор"}]}


def answer(unit):
    return {"lessonId": unit["lessonId"], "sourceHash": unit["sourceHash"], "exercises": [{"id": "e4",
             "answers": ["My neighbours are Maya and Ali. Maya is a teacher, and Ali is a nurse. They are at home today. They are not at work."],
             "explanation": EXPLANATION + " Урок " + unit["lessonId"] + ".", "scope": "illustrative", "assumptions": ["Имена вымышленные."],
             "sourceSentence": "", "checks": [{"requirement": "Представить двух соседей", "evidence": "Названы Maya и Ali с разными занятиями."},
                 {"requirement": "От трёх до пяти предложений", "evidence": "Четыре полных английских предложения с согласованными формами be."}]}]}


class ReferenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = Path(self.temp.name)
        for name in b.COURSES:
            b.atomic_json(self.app / "content/courses" / name, [lesson()] if name == b.COURSES[0] else [])
        self.args = argparse.Namespace(app=self.app, data=self.app / "data", workers=1, batch_size=3,
                       attempts=1, timeout=30, limit=0, apply_ready=False, apply_only=False, validate_only=False)
        self.plan = b.collect_inventory(self.app)
        self.unit = self.plan["units"][0]
        self.value = answer(self.unit)

    def test_only_empty_output_fields_are_selected(self):
        self.assertEqual(self.unit["targetIds"], ["e4"])
        current = deepcopy(self.unit["lesson"])
        current["exercises"][1]["answers"] = ["changed"]
        self.assertEqual(b.source_hash(current, ["e4"]), self.unit["sourceHash"])
        current["exercises"][1]["prompt"] += " Different question."
        self.assertNotEqual(b.source_hash(current, ["e4"]), self.unit["sourceHash"])

    def test_clear_source_disclosure_does_not_require_one_exact_adjective(self):
        value = deepcopy(self.value)
        item = value["exercises"][0]
        item["scope"] = "learner-dependent"
        for disclosure in ["Исходные ситуации придуманы для примера.",
                           "Запись учащегося не предоставлена и не прослушана.",
                           "Это не результат прослушивания вашей записи."]:
            item["explanation"] = EXPLANATION.replace("вымышленных", "двух") + " " + disclosure
            b.validate_patch(value, self.unit)
        item["assumptions"] = []
        with self.assertRaisesRegex(ValueError, "Learner-dependent"):
            b.validate_patch(value, self.unit)

    def test_source_and_revision_counts_do_not_become_whole_answer_limits(self):
        exercise = {"id": "e4", "kind": "write",
                    "prompt": "Сверните два предложения в именную группу и разверните одну тяжёлую группу обратно в понятное предложение.",
                    "context": "Короткий свободный ответ: 3–5 полных предложений."}
        self.assertTrue(all(c["scope"] == "parts" for c in b.quantitative_constraints(exercise)))
        b.validate_bounds("The committee rejected the proposal. It postponed the vote. The manager decided to postpone the launch.", exercise)
        exercise["prompt"] = "Сократите три повторяющихся диалога, сохранив понятность без скрытых предположений."
        self.assertTrue(all(c["scope"] == "parts" for c in b.quantitative_constraints(exercise)))
        speech = {"id": "e6", "kind": "speak", "prompt": "Произнесите мини-лекцию, затем перескажите её за 45 секунд.",
                  "context": "Говорите 90–150 секунд; затем исправьте расшифровку."}
        self.assertTrue(all(c["scope"] == "parts" for c in b.quantitative_constraints(speech)))
        # Ordinary independent output constraints still remain strict.
        exercise["prompt"] = "Напишите два предложения о соседях."
        with self.assertRaisesRegex(ValueError, "sentences guard"):
            b.validate_bounds("One is here. Two are outside. Three are working.", exercise)

    def test_publication_preserves_every_other_field_and_is_idempotent(self):
        original = deepcopy(self.unit["lesson"])
        b.apply_ready(self.args, self.plan, {self.unit["lessonId"]: self.value})
        path = self.app / "content/courses" / b.COURSES[0]
        actual = b.read(path)[0]
        expected = deepcopy(original)
        expected["exercises"][1].update({k: self.value["exercises"][0][k] for k in ("answers", "explanation")})
        self.assertEqual(actual, expected)
        self.assertEqual(actual["exercises"][0], original["exercises"][0])
        first = path.read_bytes()
        b.apply_ready(self.args, self.plan, {self.unit["lessonId"]: self.value})
        self.assertEqual(path.read_bytes(), first)

    def test_changed_prompt_and_concurrent_reference_are_rejected(self):
        current = deepcopy(self.unit["lesson"])
        current["exercises"][1]["prompt"] = "A new question"
        with self.assertRaisesRegex(ValueError, "Source changed"):
            b.patched_lesson(current, self.unit, self.value)
        current = deepcopy(self.unit["lesson"])
        current["exercises"][1]["explanation"] = "Ручная редакторская правка"
        with self.assertRaisesRegex(ValueError, "Concurrent answer edit"):
            b.patched_lesson(current, self.unit, self.value)

    def test_preflight_across_files_prevents_partial_apply_on_known_conflict(self):
        path2 = self.app / "content/courses" / b.COURSES[1]
        b.atomic_json(path2, [lesson("test-second")])
        plan = b.collect_inventory(self.app)
        patches = {u["lessonId"]: answer(u) for u in plan["units"]}
        changed = b.read(path2)
        changed[0]["exercises"][1]["hint"] = "Новая подсказка"
        b.atomic_json(path2, changed)
        before = {name: (self.app / "content/courses" / name).read_bytes() for name in b.COURSES}
        with self.assertRaisesRegex(ValueError, "Source changed"):
            b.apply_ready(self.args, plan, patches)
        self.assertEqual(before, {name: (self.app / "content/courses" / name).read_bytes() for name in b.COURSES})

    def test_report_source_plus_summary_does_not_share_two_sentence_limit(self):
        exercise = {"id": "e6", "kind": "write", "prompt": "Сократите отчёт до двух предложений.",
                    "context": "Для сравнения версий приведите исходный отчёт перед сокращением."}
        self.assertEqual(b.quantitative_constraints(exercise)[0]["scope"], "parts")
        b.validate_bounds("Original: One. Two. Three.\nSummary: One. Two.", exercise)
        exercise["context"] = "Данный отчёт уже находится в условии."
        self.assertEqual(b.quantitative_constraints(exercise)[0]["scope"], "whole")
        with self.assertRaisesRegex(ValueError, "sentences guard"):
            b.validate_bounds("One. Two. Three.", exercise)

    def test_two_deliveries_do_not_share_one_time_window(self):
        exercise = {"id": "e6", "kind": "speak", "prompt": "Произнесите фрагмент дважды: нейтрально и с мягким несогласием.",
                    "context": "Говорите 90–150 секунд; затем исправьте расшифровку и повторите ответ."}
        self.assertEqual(b.quantitative_constraints(exercise)[0]["scope"], "parts")
        b.validate_bounds("word " * 650, exercise)
        exercise["prompt"] = "Произнесите одну новую речь."
        with self.assertRaisesRegex(ValueError, "seconds guard"):
            b.validate_bounds("word " * 650, exercise)

    def test_real_word_sentence_turn_and_question_requirements(self):
        exercise = {"id": "x", "kind": "write", "prompt": "Напишите 80–120 слов.", "context": ""}
        with self.assertRaisesRegex(ValueError, "words guard"):
            b.validate_bounds("This is only a short answer.", exercise)
        exercise["prompt"] = "Напишите три полных предложения."
        b.validate_bounds("One is here. Two are outside. Three are ready.", exercise)
        with self.assertRaisesRegex(ValueError, "sentences guard"):
            b.validate_bounds("One is here. Two are outside.", exercise)
        exercise["prompt"] = "Напишите диалог из 6–8 реплик."
        b.validate_bounds("\n".join("A: That sounds good." for _ in range(6)), exercise)
        with self.assertRaisesRegex(ValueError, "turns guard"):
            b.validate_bounds("A: Hello.\nB: Hello.", exercise)
        exercise["prompt"] = "Задайте три вопроса с be."
        with self.assertRaisesRegex(ValueError, "questions"):
            b.validate_bounds("Are you here? Is she ready?", exercise)

    def test_per_part_limit_does_not_count_two_answers_as_one(self):
        exercise = {"id": "x", "kind": "write", "prompt": "Напишите две разные реакции. По 2–3 предложения на ситуацию.", "context": ""}
        bounds = b.quantitative_constraints(exercise)
        self.assertTrue(bounds and all(v["scope"] == "parts" for v in bounds))
        b.validate_bounds("One is fine. I agree. Two needs work. Please help.", exercise)

    def test_rewrite_requires_actual_source_and_all_parts_in_single_reference(self):
        unit = deepcopy(self.unit)
        exercise = unit["lesson"]["exercises"][1]
        exercise.update(kind="rewrite", prompt="Сначала перепишите одно предложение, затем перефразируйте и объясните смысл.", context="She usually works with local shops.")
        unit["sourceHash"] = b.source_hash(unit["lesson"], unit["targetIds"])
        value = answer(unit)
        item = value["exercises"][0]
        item["sourceSentence"] = "She usually works with local shops."
        item["answers"] = ["Original: She usually works with local shops.\nParaphrase: Her regular clients are local shop owners.\nThe wording changes, but it still describes her usual work."]
        b.validate_patch(value, unit)
        item["sourceSentence"] = "She works with famous actors."
        with self.assertRaisesRegex(ValueError, "actual provided original"):
            b.validate_patch(value, unit)
        item["sourceSentence"] = "She usually works with local shops."
        item["answers"].append("An incomplete alternative half.")
        with self.assertRaisesRegex(ValueError, "composite answer"):
            b.validate_patch(value, unit)

    def test_short_generic_or_undisclosed_personal_reference_is_rejected(self):
        value = deepcopy(self.value)
        value["exercises"][0]["explanation"] = "Иллюстративный образец. Проверяйте грамматику."
        with self.assertRaisesRegex(ValueError, "55 Russian words"):
            b.validate_patch(value, self.unit)
        value = deepcopy(self.value)
        value["exercises"][0]["scope"] = "learner-dependent"
        value["exercises"][0]["assumptions"] = []
        with self.assertRaisesRegex(ValueError, "assumed source"):
            b.validate_patch(value, self.unit)

    def test_verified_resume_completes_without_provider(self):
        b.atomic_json(self.args.data / "baseline-reference-inventory.json", self.plan)
        b.save_patch(self.args, self.unit, self.value)
        self.args.apply_ready = True
        with patch.object(b, "codex_command", side_effect=AssertionError("Provider must not run")):
            result = b.run(self.args)
            self.assertEqual((result["state"], result["appliedExercises"]), ("complete", 1))
            b.run(self.args)

    def test_source_drift_stops_before_provider_request(self):
        b.atomic_json(self.args.data / "baseline-reference-inventory.json", self.plan)
        path = self.app / "content/courses" / b.COURSES[0]
        current = b.read(path)
        current[0]["exercises"][1]["prompt"] = "Другой вопрос"
        b.atomic_json(path, current)
        with patch.object(b, "codex_command", side_effect=AssertionError("Provider must not run")):
            with self.assertRaisesRegex(ValueError, "Source changed since inventory"):
                b.run(self.args)

    def test_tampered_or_obsolete_cache_cannot_be_published(self):
        b.save_patch(self.args, self.unit, self.value)
        file = b.cache_path(self.args, self.unit)
        value = b.read(file)
        value["patch"]["exercises"][0]["answers"][0] += " Another sentence."
        b.atomic_json(file, value)
        self.assertIsNone(b.cached_patch(self.args, self.unit))
        b.save_patch(self.args, self.unit, self.value)
        value = b.read(file)
        value["promptVersion"] = "obsolete"
        b.atomic_json(file, value)
        self.assertIsNone(b.cached_patch(self.args, self.unit))

    def test_cli_batch_has_no_model_override_and_caches_valid_patch(self):
        completed = subprocess.CompletedProcess([], 0, json.dumps({"patches": [self.value]}), "")
        with patch.object(b.subprocess, "run", return_value=completed) as run:
            ready, errors = b.build_batch([self.unit], self.args, ["codex"], threading.Event())
        self.assertFalse(errors)
        self.assertIn(self.unit["lessonId"], ready)
        self.assertIsNotNone(b.cached_patch(self.args, self.unit))
        command = run.call_args.args[0]
        self.assertNotIn("--model", command)
        self.assertFalse(any("model_reasoning_effort" in x for x in command))
        self.assertIn("features.shell_tool=false", command)
        self.assertIn("features.unified_exec=false", command)

    def test_retry_only_requests_failed_lesson_and_keeps_valid_work(self):
        second = deepcopy(self.unit)
        second["lessonId"] = second["lesson"]["id"] = "test-second"
        second["sourceHash"] = b.source_hash(second["lesson"], second["targetIds"])
        good = answer(second)
        bad = deepcopy(good)
        bad["exercises"][0]["explanation"] = "Слишком коротко."
        responses = [subprocess.CompletedProcess([], 0, json.dumps({"patches": [self.value, bad]}), ""),
                     subprocess.CompletedProcess([], 0, json.dumps({"patches": [good]}), "")]
        self.args.attempts = 2
        with patch.object(b.subprocess, "run", side_effect=responses) as run:
            ready, errors = b.build_batch([self.unit, second], self.args, ["codex"], threading.Event())
        self.assertFalse(errors)
        self.assertEqual(set(ready), {self.unit["lessonId"], second["lessonId"]})
        retried = json.loads(run.call_args_list[1].kwargs["input"].split("\nINPUT DATA:\n", 1)[1])
        self.assertEqual([u["lessonId"] for u in retried["units"]], [second["lessonId"]])
        self.assertIsNotNone(b.cached_patch(self.args, self.unit))
        self.assertIsNotNone(b.cached_patch(self.args, second))


if __name__ == "__main__":
    unittest.main()

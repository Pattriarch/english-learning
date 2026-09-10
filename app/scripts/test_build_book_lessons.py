"""Contract checks for publishing/resuming book lessons; no model calls."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import build_book_lessons as build


def valid_lesson():
    # Deliberately synthetic text: this fixture tests shape/depth barriers, not
    # whether a model's English explanation is pedagogically correct.
    body = ("Русское объяснение значения формы и выбора в конкретном контексте. " * 16).strip()
    return {
        "title": "Настоящее время", "subtitle": "Процесс и обычные действия в конкретном контексте",
        "goal": "Научиться описывать временную ситуацию и отличать её от обычного действия.",
        "formula": "I work / I am working",
        "sections": [{"title": f"Раздел объяснения {i}", "body": body} for i in range(4)],
        "examples": [{"en": "I am preparing a report this week.", "ru": "На этой неделе я готовлю отчёт.",
                      "why": "Выбор формы объясняется временным характером работы. Контекст ограничивает ситуацию этой неделей, а не постоянной обязанностью."} for _ in range(4)],
        "exercises": [{"id": f"e{i}", "kind": ("translate", "rewrite", "write", "speak")[i % 4],
                       "prompt": "Напишите коллеге полное сообщение по-английски: на этой неделе я работаю над отчётом.",
                       "context": "Коллега спрашивает о вашей текущей рабочей задаче.",
                       "answers": ["I am working on a report this week."],
                       "hint": "Учитывайте, что описанная работа ограничена текущей неделей.",
                       "explanation": "Форма am working подчёркивает временный процесс. Это один из примеров ответа; другие естественные формулировки с тем же смыслом также допустимы."} for i in range(8)],
        "provenance": {"sourceCoverage": [{"point": f"Учебный пункт {i}", "sectionTitle": f"Раздел объяснения {i}"} for i in range(4)], "warnings": []}}


class BookBuildTests(unittest.TestCase):
    def test_shared_hash_is_exact_text_utf8(self):
        text = "Ситуация\nI'm working.\n"
        self.assertEqual(build.source_hash({"text": text, "quality": {"warnings": ["x"]}}), hashlib.sha256(text.encode("utf-8")).hexdigest())
        self.assertNotEqual(build.source_hash({"text": text}), build.source_hash({"text": text.strip()}))

    def test_real_catalog_deduplicates_and_prioritises_requested_unit(self):
        units = build.catalog_units(build.APP / "content/library.json")
        self.assertEqual(len(units), 872)
        self.assertEqual([u["unitId"] for u in units[:3]], build.PRIORITY)
        self.assertFalse(any(u["bookId"] == "grammar-intermediate-ebook" for u in units))
        self.assertEqual(len({u["unitId"] for u in units}), len(units))

    def test_atomic_write_does_not_replace_previous_file_on_error(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "lesson.json"
            build.atomic_json(path, {"previous": "Сохранено"})
            with self.assertRaises(TypeError):
                build.atomic_json(path, {"invalid": object()})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"previous": "Сохранено"})
            self.assertEqual([p.name for p in Path(directory).iterdir()], ["lesson.json"])

    def test_public_status_excludes_private_diagnostics(self):
        status = build.public_status({"total": 872, "ready": 1, "running": 4, "failed": 0,
            "state": "running", "updatedAt": "2026-09-10", "model": "private-model-choice",
            "units": {"grammar-intermediate-003": {"state": "ready", "file": "private/path", "error": "private source text"}},
            "byBook": [{"bookId": "grammar-intermediate", "total": 145, "ready": 1, "failed": 0}]})
        self.assertEqual(status["units"], {"grammar-intermediate-003": {"status": "ready", "buildStatus": "ready", "visualReady": False}})
        self.assertEqual(status["books"], {"grammar-intermediate": {"total": 145, "ready": 1, "visualReady": 0}})
        self.assertNotIn("private", json.dumps(status))

    def test_visual_upgrade_keeps_original_lesson_available(self):
        status = build.public_status({"total": 872, "ready": 0, "available": 3, "visualReady": 0,
            "units": {"grammar-intermediate-003": {"state": "running", "available": True}}})
        self.assertEqual(status["ready"], 3)
        self.assertEqual(status["visualReady"], 0)
        self.assertEqual(status["units"]["grammar-intermediate-003"]["status"], "ready")
        self.assertEqual(status["units"]["grammar-intermediate-003"]["buildStatus"], "running")

    def test_visual_coverage_requires_every_attached_page(self):
        lesson = valid_lesson()
        with self.assertRaisesRegex(ValueError, "прикреплённой страницы"):
            build.validate_lesson(lesson, [17, 18])
        lesson["provenance"]["visualCoverage"] = [{"page": page, "observations": "На странице видны контрастные формы и контекст использования грамматического времени."} for page in (17, 18)]
        build.validate_lesson(lesson, [17, 18])

    def test_page_image_hashes_reject_partial_write(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / "book"
            folder.mkdir()
            source = {"bookId": "book", "pages": [1, 2]}
            first = b"\xff\xd8image data\xff\xd9"
            (folder / "1.jpg").write_bytes(first)
            self.assertIsNone(build.image_records(source, directory))
            (folder / "2.jpg").write_bytes(b"\xff\xd8incomplete image")
            self.assertIsNone(build.image_records(source, directory))
            (folder / "2.jpg").write_bytes(first)
            self.assertEqual(build.image_records(source, directory)[0], {"page": 1, "sha256": hashlib.sha256(first).hexdigest()})

    def test_valid_shape_and_required_output_modes(self):
        lesson = valid_lesson()
        build.validate_lesson(lesson)
        lesson["exercises"][3]["kind"] = "translate"
        lesson["exercises"][7]["kind"] = "translate"
        with self.assertRaisesRegex(ValueError, "речь"):
            build.validate_lesson(lesson)

    def test_rejects_unmapped_source_coverage(self):
        lesson = valid_lesson()
        lesson["provenance"]["sourceCoverage"][0]["sectionTitle"] = "несуществующий раздел"
        with self.assertRaisesRegex(ValueError, "отсутствующий"):
            build.validate_lesson(lesson)

    def test_reference_word_count_claim_uses_actual_model_answer(self):
        lesson = valid_lesson()
        lesson["exercises"][0]["explanation"] = "Образец содержит 99 слов. Это пример ответа."
        build.normalize_reference_counts(lesson)
        self.assertEqual(lesson["exercises"][0]["explanation"], "Образец содержит 8 слов. Это пример ответа.")

    def test_reference_count_variants_and_nouns_preserve_other_numbers(self):
        for prefix in ("Образец содержит", "В образце", "Ответ содержит", "В ответе", "Модель содержит", "В модели"):
            for count, noun in ((21, "слово"), (22, "слова"), (67, "слов"), (111, "слов")):
                with self.subTest(prefix=prefix, count=count):
                    answer = " ".join(["word"] * count)
                    lesson = {"exercises": [{"answers": [answer], "prompt": "Напишите 60–120 слов.",
                        "explanation": f"{prefix} 99 слов. Нужно упомянуть 3 причины и 2 даты."}]}
                    build.normalize_reference_counts(lesson)
                    exercise = lesson["exercises"][0]
                    self.assertEqual(exercise["explanation"], f"{prefix} {count} {noun}. Нужно упомянуть 3 причины и 2 даты.")
                    self.assertEqual(exercise["answers"], [answer])
                    self.assertEqual(exercise["prompt"], "Напишите 60–120 слов.")

    def test_reference_count_counts_numerals_as_words(self):
        lesson = {"exercises": [{"answers": ["We met 6 people yesterday."], "explanation": "Ответ содержит 99 слов."}]}
        build.normalize_reference_counts(lesson)
        self.assertEqual(lesson["exercises"][0]["explanation"], "Ответ содержит 5 слов.")

    def test_rejects_short_reference_for_extended_output(self):
        lesson = valid_lesson()
        lesson["exercises"][2]["prompt"] = "Напишите другу письмо объёмом 80–100 слов о текущем рабочем проекте и обычном распорядке."
        with self.assertRaisesRegex(ValueError, "заданному объёму"):
            build.validate_lesson(lesson)

    def test_rejects_placeholders_short_theory_and_duplicates(self):
        for change in (lambda x: x["exercises"][0].update(prompt="Заполните пропуск в следующем английском предложении: I ___ working."),
                       lambda x: x["sections"][0].update(body="Текст из вашего PDF."),
                       lambda x: x["exercises"][1].update(id="e0")):
            lesson = copy.deepcopy(valid_lesson())
            change(lesson)
            with self.assertRaises(ValueError):
                build.validate_lesson(lesson)


if __name__ == "__main__":
    unittest.main()

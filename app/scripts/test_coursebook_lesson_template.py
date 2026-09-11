"""Offline contract regressions; no model, source publication or learner writes."""
from copy import deepcopy
import unittest

import coursebook_lesson_template as contract


def fixture(count=18, audio=False, family="great-writing"):
    chapter = {"unitId": "great-writing-4-001", "bookId": "great-writing-4",
               "bookTitle": "Great Writing 4", "title": "Paragraph organization",
               "family": family, "level": "B1–B2", "unit": 1, "pages": [12, 13]}
    source = {"unitId": chapter["unitId"], "bookId": chapter["bookId"],
              "pages": chapter["pages"], "source": "Great_Writing_4.pdf",
              "text": "Chapter data: rhetorical organization, specific support and coherent paragraphs. " * 20,
              "quality": {"ocr": "checked against supplied images"}}
    points = [{"id": f"point-{index}", "point": f"Specific chapter teaching point {index}: purpose, form, contrast and application.",
               "pages": [12 if index < 3 else 13]} for index in range(6)]
    images = [{"page": 12, "sha256": "a" * 64}, {"page": 13, "sha256": "b" * 64}]
    recordings = []
    if audio:
        transcript = "I wanted the blue notebook, but the clerk handed me the black one."
        recordings = [{"id": "approved-track", "title": "Проверенная запись к главе",
            "kind": "listening", "text": transcript, "source": "Локальная запись из предоставленной книги",
            "audioFile": "/api/private-book-audio/clear-track-021", "inputSkill": "listening",
            "audioSha256": "c" * 64, "transcriptSha256": contract.text_sha(transcript),
            "pages": [12], "alignmentEvidence": "Transcript opening and printed track reference checked against page 12."}]
    request = contract.build_request(chapter, source, points, images, recordings)
    theory = ("Здесь автор выбирает порядок информации с учётом цели и читателя. "
              "Основная мысль получает конкретную поддержку, а связь предложений помогает понять аргумент. "
              "Сравните английские варианты и объясните, почему один подходит для этой ситуации лучше другого. ") * 4
    rationale = ("Русское объяснение связывает выбор формы с конкретным смыслом и целью автора. "
                 "Другой вариант тоже возможен, если он сохраняет нужный смысл и отвечает задаче.")
    sections = [{"title": f"Раздел {index}: цель и выбор", "body": theory} for index in range(6)]
    kinds = {0: "rewrite", 1: "write", 2: "write", count - 4: "write", count - 3: "speak",
             count - 2: "rewrite", count - 1: "write"}
    exercises = []
    for index in range(count):
        kind = kinds.get(index, "translate" if index % 2 else "rewrite")
        prompt = ("Напишите коллеге 10–30 слов: объясните, почему нужно поменять порядок аргументов в письме клиенту."
                  if kind == "write" else
                  "Запишите голосовой ответ коллеге, 10–30 слов: объясните, почему нужно поменять порядок аргументов."
                  if kind == "speak" else
                  "Передайте коллеге законченную мысль на английском: сначала укажите цель письма, затем приведите довод.")
        if index == count - 2:
            prompt = ("Добавьте исходный фрагмент своего предыдущего ответа, затем исправленную версию: "
                      "усильте связь аргумента с целью читателя и объясните выбор.")
        exercises.append({"id": f"e{index + 1}", "kind": kind, "prompt": prompt,
            "context": "You are explaining the organization of a client email to a coworker.",
            "answers": ["We should explain the customer's main concern first and then support our recommendation with a concrete example."],
            "hint": "Подумайте, какой вопрос читателя должен получить ответ прежде остальных деталей.",
            "explanation": rationale})
    materials = [{"id": "original-reading", "title": "Новое письмо заказчику", "kind": "reading",
                  "text": "Our team recommends postponing the launch. The latest tests revealed a problem with payment processing.",
                  "source": "Авторский материал по теме главы"}]
    exercises[1]["materialIds"] = ["original-reading"]
    exercises[2]["materialIds"] = ["original-reading"]
    if audio:
        materials.extend(deepcopy(request["payload"]["approvedMaterials"]))
        exercises[2]["materialIds"] = ["approved-track"]
        exercises[count - 3]["materialIds"] = ["approved-track"]
    stage_indices = [[0], [1, 2], list(range(3, count - 4)), [count - 4, count - 3], [count - 2], [count - 1]]
    stages = [{"id": stage_id, "title": f"Этап обучения {stage_id}",
               "purpose": "Понять конкретную задачу автора и применить изученную тему в собственном ответе.",
               "exerciseIds": [exercises[index]["id"] for index in indices], "minutes": 20}
              for stage_id, indices in zip(contract.STAGES, stage_indices)]
    provenance = deepcopy(request["payload"]["requiredProvenance"])
    provenance.update({"warnings": [], "sourceCoverage": [
        {"pointId": point["id"], "point": point["point"], "sectionTitle": sections[index]["title"],
         "exerciseIds": [exercises[index]["id"]]} for index, point in enumerate(points)],
        "visualCoverage": [{"page": image["page"], "observations":
            "На странице различимы заголовок и схема: порядок аргументов показан стрелками, а пояснение связано с примером письма."}
            for image in images]})
    lesson = {"id": "book-" + chapter["unitId"], "title": "Понятная структура убедительного письма",
        "subtitle": "Как связать цель, аргумент и ожидания читателя в собственном английском тексте.",
        "level": chapter["level"], "group": "По учебникам", "units": "Great Writing 4 · Unit 1",
        "minutes": 100, "goal": "Составить связное письмо конкретному адресату, обосновать выбор аргументов и улучшить свой текст после обратной связи.",
        "formula": "Цель → аргумент → конкретное подтверждение → следующий шаг читателя.",
        "sections": sections, "examples": [{"en": f"Our next step {index} should address the customer's main concern.",
            "ru": "Следующий шаг должен учитывать основное беспокойство заказчика.", "why": rationale} for index in range(8)],
        "materials": materials, "exercises": exercises, "generated": True, "provenance": provenance,
        "studyPlan": {"stages": stages, "revisionExerciseIds": deepcopy(stages[4]["exerciseIds"]),
                      "transfer": {"exerciseIds": deepcopy(stages[5]["exerciseIds"]), "delayDays": 7}}}
    return lesson, request


class ChapterRequestTests(unittest.TestCase):
    def test_entire_source_and_original_inputs_preserved(self):
        lesson, request = fixture()
        before = deepcopy((lesson, request))
        self.assertIs(contract.validate_lesson(lesson, request), lesson)
        self.assertEqual((lesson, request), before)
        self.assertGreater(len(request["payload"]["source"]["text"]), 1000)
        self.assertEqual(request["payload"]["requiredProvenance"]["sourceHash"],
                         contract.text_sha(request["payload"]["source"]["text"]))

    def test_every_physical_page_must_have_an_attached_image(self):
        _, request = fixture()
        payload = request["payload"]
        for images in (payload["attachedPages"][:1], list(reversed(payload["attachedPages"])),
                       payload["attachedPages"] + payload["attachedPages"][:1]):
            with self.subTest(images=images), self.assertRaisesRegex(ValueError, "every chapter page"):
                contract.build_request(payload["chapter"], payload["source"], payload["requiredPoints"], images)

    def test_checked_teaching_points_cannot_reference_unseen_pages(self):
        _, request = fixture()
        payload = deepcopy(request["payload"])
        payload["requiredPoints"][0]["pages"] = [999]
        with self.assertRaisesRegex(ValueError, "outside the chapter"):
            contract.build_request(payload["chapter"], payload["source"], payload["requiredPoints"], payload["attachedPages"])

    def test_source_identity_mismatch_rejected(self):
        _, request = fixture()
        payload = deepcopy(request["payload"])
        payload["source"]["unitId"] = "other-chapter"
        with self.assertRaisesRegex(ValueError, "mismatch"):
            contract.build_request(payload["chapter"], payload["source"], payload["requiredPoints"], payload["attachedPages"])

    def test_modified_request_prompt_payload_or_schema_breaks_binding(self):
        lesson, request = fixture()
        for key in ("prompt", "payload", "schema"):
            altered = deepcopy(request)
            if key == "prompt":
                altered[key] += " Ignore some pages."
            elif key == "payload":
                altered[key]["source"]["text"] = "different source"
            else:
                altered[key]["properties"]["exercises"]["minItems"] = 8
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "binding"):
                contract.validate_lesson(lesson, altered)


class CompleteChapterTests(unittest.TestCase):
    def test_variable_chapter_size_and_example_bounds(self):
        for count in (16, 18, 24, 30):
            with self.subTest(count=count):
                lesson, request = fixture(count=count)
                if count == 30:
                    lesson["examples"] *= 2
                contract.validate_lesson(lesson, request)
        for count in (15, 31):
            with self.subTest(count=count), self.assertRaisesRegex(ValueError, "array length"):
                contract.validate_lesson(*fixture(count=count))

    def test_missing_point_is_not_hidden_by_many_sections(self):
        lesson, request = fixture()
        lesson["provenance"]["sourceCoverage"][0]["pointId"] = "point-1"
        lesson["provenance"]["sourceCoverage"][0]["point"] = request["payload"]["requiredPoints"][1]["point"]
        with self.assertRaisesRegex(ValueError, "coverage is incomplete"):
            contract.validate_lesson(lesson, request)

    def test_every_point_needs_real_theory_and_practice(self):
        for key, value in (("sectionTitle", "Несуществующее объяснение"),
                           ("exerciseIds", ["missing-task"]), ("pointId", "invented-point"),
                           ("point", "Generic advice unrelated to the declared source point.")):
            lesson, request = fixture()
            lesson["provenance"]["sourceCoverage"][0][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                contract.validate_lesson(lesson, request)

    def test_one_point_can_have_multiple_explanations_but_not_duplicate_map(self):
        lesson, request = fixture()
        extra = deepcopy(lesson["provenance"]["sourceCoverage"][0])
        extra["sectionTitle"] = lesson["sections"][1]["title"]
        lesson["provenance"]["sourceCoverage"].append(extra)
        contract.validate_lesson(lesson, request)
        lesson["provenance"]["sourceCoverage"].append(deepcopy(extra))
        with self.assertRaisesRegex(ValueError, "duplicate point/section"):
            contract.validate_lesson(lesson, request)

    def test_immutable_source_hash_pages_and_visual_evidence(self):
        for key, value in (("sourceHash", "f" * 64), ("pages", [12]),
                           ("sourceImages", [{"page": 12, "sha256": "f" * 64}]),
                           ("source", "Different_Book.pdf")):
            lesson, request = fixture()
            lesson["provenance"][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "immutable"):
                contract.validate_lesson(lesson, request)
        lesson, request = fixture()
        lesson["provenance"]["visualCoverage"].pop()
        with self.assertRaisesRegex(ValueError, "every source page"):
            contract.validate_lesson(lesson, request)

    def test_model_answers_must_fit_every_open_task(self):
        lesson, request = fixture()
        lesson["exercises"][1]["answers"].append("This answer is too short.")
        with self.assertRaisesRegex(ValueError, "requested output length"):
            contract.validate_lesson(lesson, request)

    def test_explicit_rewrite_budgets_apply_to_each_labeled_block(self):
        lesson, request = fixture()
        exercise = next(item for item in lesson["exercises"] if item["kind"] == "rewrite")
        exercise["prompt"] = "Покажите исходный и исправленный тексты отдельными блоками: Original: 5–10 слов; Revised: 5–10 слов. Объяснение должно быть понятно адресату."
        exercise["answers"] = ["Original: Please tell me about the meeting today.\nRevised: Could you send the agenda before the meeting?"]
        contract.validate_lesson(lesson, request)
        exercise["answers"] = ["Original: Please tell me about the meeting today.\nRevised: Send it."]
        with self.assertRaisesRegex(ValueError, "block Revised has 2 words"):
            contract.validate_lesson(lesson, request)

    def test_no_multiple_choice_or_gaps(self):
        for prompt in ("Выберите правильный ответ и объясните, почему остальные варианты неверны в этой ситуации.",
                       "Вставьте пропуск в предложении и объясните выбор английского времени в контексте.",
                       "Complete the sentence with the phrase ___ and explain your answer in a whole paragraph."):
            lesson, request = fixture()
            lesson["exercises"][0]["prompt"] = prompt
            with self.subTest(prompt=prompt), self.assertRaises(ValueError):
                contract.validate_lesson(lesson, request)


class LearningWorkflowTests(unittest.TestCase):
    def test_missing_or_repeated_assignment_rejected(self):
        for mutation in (lambda plan: plan["stages"][2]["exerciseIds"].pop(),
                         lambda plan: plan["stages"][2]["exerciseIds"].append("e1")):
            lesson, request = fixture()
            mutation(lesson["studyPlan"])
            with self.assertRaisesRegex(ValueError, "exactly one"):
                contract.validate_lesson(lesson, request)

    def test_stage_order_and_revision_mapping_are_enforced(self):
        lesson, request = fixture()
        lesson["studyPlan"]["stages"][0], lesson["studyPlan"]["stages"][1] = lesson["studyPlan"]["stages"][1], lesson["studyPlan"]["stages"][0]
        with self.assertRaisesRegex(ValueError, "ordered"):
            contract.validate_lesson(lesson, request)
        lesson, request = fixture()
        lesson["studyPlan"]["revisionExerciseIds"] = ["e1"]
        with self.assertRaisesRegex(ValueError, "revision exercise mapping"):
            contract.validate_lesson(lesson, request)

    def test_independent_production_needs_writing_and_speaking(self):
        lesson, request = fixture()
        lesson["exercises"][-3]["kind"] = "write"
        with self.assertRaisesRegex(ValueError, "writing and speaking"):
            contract.validate_lesson(lesson, request)

    def test_revision_must_include_learner_original_and_revised_answer(self):
        lesson, request = fixture()
        lesson["exercises"][-2]["prompt"] = "Перепишите свой ответ с учётом обратной связи и объясните, почему внесли именно такие изменения."
        with self.assertRaisesRegex(ValueError, "original and revised"):
            contract.validate_lesson(lesson, request)

    def test_transfer_delay_and_task_identity(self):
        for delay in (0, 6, 61, True):
            lesson, request = fixture()
            lesson["studyPlan"]["transfer"]["delayDays"] = delay
            with self.subTest(delay=delay), self.assertRaises(ValueError):
                contract.validate_lesson(lesson, request)
        lesson, request = fixture()
        lesson["studyPlan"]["transfer"]["exerciseIds"] = ["e1"]
        with self.assertRaisesRegex(ValueError, "transfer exercise mapping"):
            contract.validate_lesson(lesson, request)

    def test_input_requires_linked_reading_or_listening(self):
        lesson, request = fixture()
        lesson["exercises"][1]["materialIds"] = []
        with self.assertRaisesRegex(ValueError, "input stage exercise"):
            contract.validate_lesson(lesson, request)
        lesson, request = fixture()
        lesson["materials"][0]["kind"] = "reference"
        with self.assertRaisesRegex(ValueError, "input stage exercise"):
            contract.validate_lesson(lesson, request)


class ApprovedRecordingTests(unittest.TestCase):
    def test_exact_private_audio_reference_works_without_assumed_route(self):
        lesson, request = fixture(audio=True, family="clear-speech")
        contract.validate_lesson(lesson, request)
        self.assertTrue(lesson["materials"][1]["audioFile"].startswith("/api/private-book-audio/"))

    def test_recording_transcript_and_provenance_cannot_drift(self):
        for key, value in (("audioFile", "/assets/made-up-track.mp3"), ("text", "A plausible but unchecked new transcript."),
                           ("title", "Different recording")):
            lesson, request = fixture(audio=True)
            lesson["materials"][1][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "recording material changed"):
                contract.validate_lesson(lesson, request)
        lesson, request = fixture(audio=True)
        lesson["provenance"]["approvedAudio"][0]["audioSha256"] = "d" * 64
        with self.assertRaisesRegex(ValueError, "immutable"):
            contract.validate_lesson(lesson, request)

    def test_no_invented_recording_and_synthetic_script_labeled_honestly(self):
        lesson, request = fixture()
        lesson["materials"][0].update(kind="listening", audioFile="/assets/fake.mp3", inputSkill="listening")
        with self.assertRaisesRegex(ValueError, "unapproved"):
            contract.validate_lesson(lesson, request)
        del lesson["materials"][0]["audioFile"]
        lesson["materials"][0]["inputSkill"] = "listening-script"
        contract.validate_lesson(lesson, request)

    def test_recording_requires_actual_input_task_and_clear_speech_output(self):
        lesson, request = fixture(audio=True, family="clear-speech")
        lesson["exercises"][2]["materialIds"] = ["original-reading"]
        with self.assertRaisesRegex(ValueError, "no input exercise"):
            contract.validate_lesson(lesson, request)
        lesson, request = fixture(audio=True, family="clear-speech")
        lesson["exercises"][-3].pop("materialIds")
        with self.assertRaisesRegex(ValueError, "linked speaking"):
            contract.validate_lesson(lesson, request)

    def test_wrong_transcript_hash_is_rejected_before_authoring(self):
        _, request = fixture(audio=True)
        payload = request["payload"]
        audio = {**payload["approvedMaterials"][0], **{
            key: value for key, value in payload["requiredProvenance"]["approvedAudio"][0].items()
            if key not in {"materialId"}}, "alignmentEvidence": "Checked printed track label and original transcript on the page."}
        audio["transcriptSha256"] = "e" * 64
        with self.assertRaisesRegex(ValueError, "hashes"):
            contract.build_request(payload["chapter"], payload["source"], payload["requiredPoints"], payload["attachedPages"], [audio])


class IndependentReviewBindingTests(unittest.TestCase):
    def test_review_uses_exact_candidate_and_complete_source(self):
        lesson, request = fixture()
        review_request = contract.build_review_request(lesson, request)
        self.assertEqual(review_request["payload"]["authorInput"], request["payload"])
        self.assertEqual(review_request["payload"]["candidate"], lesson)
        review = {key: review_request["payload"][key] for key in ("unitId", "requestSha256", "candidateSha256")}
        review.update(decision="accept", findings=[])
        self.assertTrue(contract.validate_review(review, lesson, request))
        lesson["exercises"][0]["answers"][0] = "The client needs a concrete example before making a final decision about our proposal."
        with self.assertRaisesRegex(ValueError, "exact request and candidate"):
            contract.validate_review(review, lesson, request)

    def test_acceptance_cannot_silently_have_corrections(self):
        lesson, request = fixture()
        review = {"unitId": request["payload"]["chapter"]["unitId"], "requestSha256": request["sha256"],
                  "candidateSha256": contract.value_sha(lesson), "decision": "accept",
                  "findings": [{"pointId": "point-1", "exerciseId": "e1", "issue": "The exercise does not practice the point's actual contrast."}]}
        with self.assertRaisesRegex(ValueError, "contradicts"):
            contract.validate_review(review, lesson, request)
        review["decision"] = "revise"
        self.assertFalse(contract.validate_review(review, lesson, request))
        review["findings"] = []
        with self.assertRaisesRegex(ValueError, "contradicts"):
            contract.validate_review(review, lesson, request)


class AuthorPromptCompatibilityTests(unittest.TestCase):
    def test_historical_prompt_and_repair_requirement_bytes_stay_exact(self):
        # These strings already bind persisted model requests and repairs.
        hashes = {
            "LEGACY_AUTHOR_PROMPT": "681aba4eb692b9059c9c21b8d073f436d8033aef9f925850b6c8ecd405ce6a8f",
            "DEPTH_AUTHOR_PROMPT": "c0f469184b4c79830f8aecf7a37c1b0a4b21993c9035e9d3e9a4ba8bfa35d0ea",
            "MULTIPART_AUTHOR_PROMPT": "b1a2f56896a8a78bf0f026c95ef59a83de3f2a54bd34043b4ee9a7df6d533bb5",
            "AUTHOR_REQUIREMENTS": "fee31c566bbdd99ffd0b6a1ead121730ac2c9b090bb5523bed6c0bece5c8c304",
        }
        for name, digest in hashes.items():
            with self.subTest(name=name):
                self.assertEqual(contract.text_sha(getattr(contract, name)), digest)
        self.assertNotEqual(contract.AUTHOR_PROMPT, contract.MULTIPART_AUTHOR_PROMPT)
        self.assertTrue(contract.AUTHOR_PROMPT.startswith(contract.MULTIPART_AUTHOR_PROMPT + "\n"))

    def test_every_historical_request_remains_valid_with_its_own_original_hash(self):
        lesson, current = fixture()
        for prompt in (contract.LEGACY_AUTHOR_PROMPT, contract.DEPTH_AUTHOR_PROMPT,
                       contract.MULTIPART_AUTHOR_PROMPT):
            with self.subTest(prompt_sha256=contract.text_sha(prompt)):
                old = {"prompt": prompt, "payload": deepcopy(current["payload"]),
                       "schema": deepcopy(current["schema"])}
                old["sha256"] = contract.value_sha(old)
                snapshot = deepcopy(old)
                self.assertEqual(contract.validate_request(old), current["payload"])
                self.assertIs(contract.validate_lesson(lesson, old), lesson)
                self.assertEqual(old, snapshot)

    def pronunciation_revision_fixture(self):
        lesson, request = fixture()
        # The input is an explicitly unrecorded original script; it does not
        # claim a hidden partner or an independently unheard performance.
        lesson["materials"].append({"id": "original-dialogue", "title": "Порядок рабочего обновления",
            "kind": "dialogue", "inputSkill": "listening-script",
            "source": "Авторский сценарий для чтения и поддерживаемой ролевой практики",
            "text": "Alex: The report is delayed because two invoices are missing. Casey: Tell the manager the reason first, then explain when you will call the supplier."})
        lesson["exercises"][2].update(materialIds=["original-dialogue"],
            prompt="Прочитайте original-dialogue как открытый сценарий ролевой практики. Ответ: 15–30 слов. Объясните, зачем Casey предлагает такой порядок рабочего сообщения.",
            answers=["Casey suggests giving the reason first so the manager understands the delay before considering the next action and its timing."])
        message = ("The supplier report is delayed because two invoices are missing. I will call the supplier at noon "
                   "and update the shared folder before our meeting.")
        reflection = "I prioritized the reason for the delay and the promised next action."
        lesson["exercises"][15].update(
            prompt="Оставьте руководителю самостоятельное обновление о задержке: Message: 20–30 слов; Reflection: 10–15 слов. Запишите и сохраните аудиозапись примерно на 25–40 секунд.",
            context="Руководителю нужно понять причину задержки и время следующего действия; учебное пояснение находится в отдельном блоке.",
            answers=["Message:\n" + message + "\nReflection:\n" + reflection])
        revised = message.replace("missing", "MISSING").replace("noon", "NOON")
        lesson["exercises"][16].update(kind="write",
            prompt="Прослушайте свою запись e16. Возьмите только собственный блок Message, без Reflection, и отправьте письменные блоки Original: 20–30 слов; Revised: 20–30 слов; Comparison: 15–25 слов. Вставьте фактический исходный текст, затем исправленную разметку фокуса. Запишите и сохраните сопоставимую новую аудиозапись, прослушайте обе версии и объясните выбранную поправку.",
            context="Это письменное представление переработки собственной речи; акустические изменения проверяются самостоятельным сравнением двух сохранённых записей.",
            answers=["Original:\n" + message + "\nRevised:\n" + revised +
                "\nComparison:\nI emphasized MISSING to explain the delay and NOON to make the next action clear for the manager."],
            hint="Сохраните собственные факты и выделите причину и следующий шаг; не подменяйте свою первую версию справочным примером.",
            explanation="Пример показывает возможную разметку собственного сообщения, а не результат прослушивания ученика. Письменный ответ предъявляет исходную версию, исправленную разметку и осмысленное сравнение; акустический результат ученик сопоставляет по двум своим записям.")
        return lesson, request

    def test_future_request_accepts_complete_own_speech_revision_and_original_script(self):
        lesson, request = self.pronunciation_revision_fixture()
        self.assertEqual(request["prompt"], contract.AUTHOR_PROMPT)
        self.assertIs(contract.validate_lesson(lesson, request), lesson)
        production = lesson["studyPlan"]["stages"][3]["exerciseIds"]
        self.assertEqual({e["kind"] for e in lesson["exercises"] if e["id"] in production}, {"write", "speak"})

    def test_new_guidance_does_not_relax_revision_or_unrecorded_material_guards(self):
        lesson, request = self.pronunciation_revision_fixture()
        lesson["exercises"][16]["kind"] = "speak"
        with self.assertRaisesRegex(ValueError, "revision must rewrite"):
            contract.validate_lesson(lesson, request)
        lesson, request = self.pronunciation_revision_fixture()
        del lesson["materials"][-1]["inputSkill"]
        with self.assertRaisesRegex(ValueError, "listening-script"):
            contract.validate_lesson(lesson, request)


if __name__ == "__main__":
    unittest.main()

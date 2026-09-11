"""Offline full-source pipeline regressions; no model calls or learner writes."""
from copy import deepcopy
from contextlib import redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, call, patch

import coursebook_lesson_template as contract
import generate_new_coursebooks as pipeline
from test_coursebook_lesson_template import fixture as lesson_fixture


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def isolate_provider_files(test, root):
    test.enterContext(patch.object(pipeline, "WORK", Path(root) / "shared-work"))
    test.enterContext(patch.object(pipeline, "LEXICON_RUN_STATUS",
                                  Path(root) / "lexicon" / "run-status.json"))


def bundle_fixture(root):
    lesson, request = lesson_fixture()
    chapter = deepcopy(request["payload"]["chapter"])
    source = deepcopy(request["payload"]["source"])
    source["source"] = "ocr"
    source.update({"title": chapter["title"], "pageTexts": [
        {"page": page, "sourcePage": page, "printedPage": page - 10,
         "text": source["text"]} for page in chapter["pages"]], "supportingSources": []})
    source["text"] = "\n\n".join(page["text"] for page in source["pageTexts"])
    source["supportingSources"] = [{"bookId": "teacher-notes", "kind": "teacher-notes",
        "pages": [5], "source": "Teacher_notes.pdf", "text":
        "Teacher notes: compare how the same supporting detail serves two different readers.",
        "pageTexts": [{"page": 5, "text": "Use audience contrast when reviewing the writer's support."}]}]
    source_file = root / "source.json"
    write_json(source_file, source)
    attachments = []
    for book_id, page, role in ([(chapter["bookId"], page, "chapter") for page in chapter["pages"]]
                                + [("teacher-notes", 5, "companion")]):
        path = root / f"{book_id}-page-{page}.jpg"
        raw = b"\xff\xd8\xff\xe0" + f"offline-page-{page}".encode() + b"\xff\xd9"
        path.write_bytes(raw)
        attachments.append({"id": f"{role}-page-{page}", "bookId": book_id,
                            "page": page, "role": role, "path": str(path),
                            "sha256": hashlib.sha256(raw).hexdigest()})
    bundle = {"version": pipeline.VERSION, "chapter": chapter, "source": source,
              "headingCandidates": [{"id": "heading-1", "page": 12, "endPage": 13,
                                     "headings": ["Organizing and supporting a paragraph"]}],
              "approvedMaterials": [], "declaredAudioTracks": [], "attachments": attachments,
              "sourceFiles": [{"path": str(source_file),
                               "sha256": hashlib.sha256(source_file.read_bytes()).hexdigest()}]}
    bundle["sourceSetSha256"] = contract.value_sha(bundle)
    analysis = {"unitId": chapter["unitId"], "bundleSha256": bundle["sourceSetSha256"],
                "requiredPoints": deepcopy(request["payload"]["requiredPoints"]),
                "pageCoverage": [{"attachmentId": image["id"], "observations":
                    f"Page {image['page']} contains the organization diagram and contrasts the main claim "
                    "with supporting details; the visual relationship informs both explanation and practice."}
                    for image in attachments],
                "headingCoverage": [{"candidateId": "heading-1", "pointIds": [
                    point["id"] for point in request["payload"]["requiredPoints"]],
                    "reason": "The heading introduces organization, support and their connected writing choices."}],
                "unresolved": []}
    return bundle, analysis, lesson


class OfflinePipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.work = self.root / "generated"
        isolate_provider_files(self, self.root)
        self.bundle, self.analysis, self.lesson = bundle_fixture(self.root)
        self.calls = []
        self.reject_stage = None
        self.reject_once = False
        self.rejected = False
        self.author_count = 0

    def fake_model(self, prompt, payload, schema, attachments, path, timeout):
        """Exercise real disk caches and validators while replacing only the CLI."""
        self.assertFalse((self.work / "verified.json").exists(),
                         "A final receipt was written before the last independent review")
        self.calls.append({"prompt": prompt, "payload": deepcopy(payload),
                           "schema": deepcopy(schema), "attachments": deepcopy(attachments),
                           "path": str(path)})
        fields = set(schema["properties"])
        if "requiredPoints" in fields:
            result = deepcopy(self.analysis)
        elif "sections" in fields:
            self.author_count += 1
            result = deepcopy(self.lesson)
            result["title"] += f" · версия {self.author_count}"
            author = payload.get("originalInput", payload)
            result["provenance"].update(deepcopy(author["requiredProvenance"]))
        else:
            stage = "analysis" if "inputSha256" in fields else "lesson"
            reject = stage == self.reject_stage and (not self.reject_once or not self.rejected)
            self.rejected |= reject
            result = {"unitId": self.bundle["chapter"]["unitId"],
                      "candidateSha256": payload["candidateSha256"],
                      "decision": "revise" if reject else "accept", "findings": []}
            if stage == "analysis":
                result["inputSha256"] = payload["inputSha256"]
                if reject:
                    result["findings"] = ["Explain the page-specific support contrast before authoring the lesson."]
            else:
                result["requestSha256"] = payload["requestSha256"]
                if reject:
                    result["findings"] = [{"pointId": "point-0", "exerciseId": "e1",
                        "issue": "Revise the learner task to explain how its support matches the intended reader."}]
        write_json(path, result)
        return result

    def run_offline(self):
        with patch.object(pipeline, "call_model", side_effect=self.fake_model):
            return pipeline.run_chapter(self.bundle, self.work, timeout=10)

    def ready_receipt(self):
        return json.loads((self.work / "verified.json").read_text(encoding="utf-8"))

    def test_authoritative_id_normalizes_only_raw_id_before_exact_review(self):
        self.lesson["id"] = "invented-adaptation"
        self.run_offline()
        raw = pipeline.read(self.work / "lesson-draft-1.json")
        self.assertEqual(raw["id"], "invented-adaptation")
        receipt = self.ready_receipt()
        expected = deepcopy(raw)
        expected["id"] = "book-" + self.bundle["chapter"]["unitId"]
        self.assertEqual(receipt["lesson"], expected)
        review = pipeline.read(self.work / "lesson-review-1.request.json")
        self.assertEqual(review["payload"]["candidate"], expected)
        self.assertEqual(len(receipt["identityNormalizations"]), 1)
        evidence = self.work / receipt["identityNormalizations"][0]["file"]
        tampered = pipeline.read(evidence)
        tampered["changes"].append({"path": "goal", "before": "x", "after": "y"})
        write_json(evidence, tampered)
        receipt["identityNormalizations"][0]["sha256"] = pipeline.file_sha(evidence)
        with self.assertRaisesRegex(ValueError, "more than authoritative ID"):
            pipeline.verify_ready(receipt, self.bundle, self.work)

    def test_known_legacy_author_cache_preserved_but_source_change_rejected(self):
        original = contract.AUTHOR_PROMPT
        with patch.object(contract, "AUTHOR_PROMPT", contract.LEGACY_AUTHOR_PROMPT):
            self.run_offline()
        request = pipeline.author_request(self.bundle, self.analysis, self.work)
        self.assertEqual(request["prompt"], contract.LEGACY_AUTHOR_PROMPT)
        self.assertNotEqual(request["prompt"], original)
        self.assertTrue(pipeline.verify_ready(self.ready_receipt(), self.bundle, self.work))
        changed = deepcopy(self.analysis)
        changed["requiredPoints"][0]["point"] += " A new substantive source point."
        with self.assertRaisesRegex(ValueError, "current full chapter"):
            pipeline.author_request(self.bundle, changed, self.work)

    def legacy_identity_repair_fixture(self):
        request = pipeline.author_request(self.bundle, self.analysis)
        base = {key: deepcopy(request[key]) for key in ("prompt", "payload", "schema")}
        base["prompt"] = contract.LEGACY_AUTHOR_PROMPT
        prior = deepcopy(self.lesson)
        prior["id"] = "legacy-adaptation-id"
        candidate = deepcopy(prior)
        candidate["id"] = "book-" + self.bundle["chapter"]["unitId"]
        expected = pipeline.revised_request(base, prior,
            ["lesson identity/level differs from the supplied chapter"])
        committed = {"version": pipeline.VERSION, **deepcopy(expected),
                     "transportSchema": pipeline.strict_model_schema(expected["schema"]),
                     "attachments": deepcopy(self.bundle["attachments"])}
        committed["sha256"] = contract.value_sha(committed)
        checkpoint = self.work / "lesson-draft-1-repair-1.json"
        returned = deepcopy(prior)
        returned["id"] = self.bundle["chapter"]["unitId"]
        write_json(checkpoint, returned)
        write_json(checkpoint.with_suffix(".request.json"), committed)
        return checkpoint, base, candidate, expected, returned

    def test_legacy_identity_repair_reuses_exact_returned_metadata_request_without_cli(self):
        checkpoint, base, candidate, expected, returned = self.legacy_identity_repair_fixture()
        inputs = deepcopy((base, candidate, self.bundle["attachments"]))
        original_response = checkpoint.read_bytes()
        original_request = checkpoint.with_suffix(".request.json").read_bytes()
        with patch.object(pipeline, "call_model") as model:
            reused = pipeline.legacy_identity_repair(checkpoint, base, candidate,
                                                     self.bundle["attachments"])
            self.assertEqual(reused, expected)
            self.assertEqual(reused["payload"]["previousCandidate"]["id"],
                             "legacy-adaptation-id")
            self.assertEqual(pipeline.cached_call(checkpoint, **reused,
                attachments=self.bundle["attachments"], timeout=10), returned)
            model.assert_not_called()
        self.assertEqual((base, candidate, self.bundle["attachments"]), inputs)
        self.assertEqual(checkpoint.read_bytes(), original_response)
        self.assertEqual(checkpoint.with_suffix(".request.json").read_bytes(), original_request)
        self.assertFalse((self.work / "verified.json").exists())

    def test_legacy_identity_repair_rejects_non_id_changes_in_prior_candidate(self):
        checkpoint, base, candidate, _, _ = self.legacy_identity_repair_fixture()
        binding = checkpoint.with_suffix(".request.json")
        original = pipeline.read(binding)
        for location in ("candidate-goal", "candidate-exercise", "stored-prior"):
            with self.subTest(location=location):
                changed = deepcopy(candidate)
                stored = deepcopy(original)
                if location == "candidate-goal":
                    changed["goal"] += " A different teaching objective."
                elif location == "candidate-exercise":
                    changed["exercises"][0]["answers"][0] += " An altered reference answer."
                else:
                    stored["payload"]["previousCandidate"]["goal"] += " Changed cached content."
                    stored["sha256"] = contract.value_sha(
                        {key: value for key, value in stored.items() if key != "sha256"})
                write_json(binding, stored)
                with self.assertRaisesRegex(ValueError, "changed the prior candidate"):
                    pipeline.legacy_identity_repair(checkpoint, base, changed,
                                                    self.bundle["attachments"])
        write_json(binding, original)

    def test_legacy_identity_repair_rejects_changed_source_and_attachment_binding(self):
        checkpoint, base, candidate, expected, _ = self.legacy_identity_repair_fixture()
        binding = checkpoint.with_suffix(".request.json")
        original = pipeline.read(binding)
        for change in ("current-source", "cached-source", "missing-companion",
                       "attachment-hash", "attachment-path", "attachment-role"):
            with self.subTest(change=change):
                changed_base = deepcopy(base)
                attachments = deepcopy(self.bundle["attachments"])
                stored = deepcopy(original)
                if change == "current-source":
                    changed_base["payload"]["source"]["text"] += " Changed full source."
                elif change == "cached-source":
                    stored["payload"]["originalInput"]["source"]["text"] += " Altered cached source."
                    stored["sha256"] = contract.value_sha(
                        {key: value for key, value in stored.items() if key != "sha256"})
                elif change == "missing-companion":
                    attachments.pop()
                elif change == "attachment-hash":
                    attachments[-1]["sha256"] = "0" * 64
                elif change == "attachment-path":
                    attachments[-1]["path"] = str(self.root / "another-page.jpg")
                else:
                    attachments[-1]["role"] = "chapter"
                write_json(binding, stored)
                with self.assertRaisesRegex(ValueError, "source/request binding changed"):
                    pipeline.legacy_identity_repair(checkpoint, changed_base, candidate, attachments)
        write_json(binding, original)
        # This helper compares committed metadata; the real cache separately
        # checks live image bytes even when a returned response already exists.
        image = Path(self.bundle["attachments"][-1]["path"])
        image.write_bytes(b"\xff\xd8changed companion image\xff\xd9")
        reused = pipeline.legacy_identity_repair(checkpoint, base, candidate,
                                                 self.bundle["attachments"])
        self.assertEqual(reused, expected)
        with patch.object(pipeline, "call_model") as model, \
                self.assertRaisesRegex(ValueError, "Cached request image changed"):
            pipeline.cached_call(checkpoint, **reused,
                attachments=self.bundle["attachments"], timeout=10)
        model.assert_not_called()

    def test_precise_depth_findings_collect_all_fields_and_ranges_without_mutation(self):
        lesson = deepcopy(self.lesson)
        lesson["examples"][0]["why"] = "Коротко"
        for exercise in lesson["exercises"]:
            if exercise["kind"] in {"write", "speak"}:
                exercise["prompt"] = "Напишите ответ без диапазона объема."
                break
        before = deepcopy(lesson)
        findings = contract.lesson_depth_findings(lesson)
        self.assertTrue(any("examples[0].why" in value and "90" in value for value in findings))
        self.assertTrue(any("missing explicit N–M слов" in value for value in findings))
        self.assertEqual(lesson, before)

    def test_editorial_observations_are_bound_to_inspected_draft_and_actual_review(self):
        def author_then_editor(prompt, payload, schema, attachments, path, timeout):
            result = self.fake_model(prompt, payload, schema, attachments, path, timeout)
            if "sections" in schema["properties"]:
                write_json(self.work / "editorial-findings.json", {
                    "version": 1, "sourceSetSha256": self.bundle["sourceSetSha256"],
                    "unitId": self.bundle["chapter"]["unitId"], "candidateFile": Path(path).name,
                    "candidateSha256": pipeline.file_sha(path),
                    "findings": ["Check that the independent message is clearly separated from reflection."]})
            return result

        with patch.object(pipeline, "call_model", side_effect=author_then_editor):
            pipeline.run_chapter(self.bundle, self.work, timeout=10)
        request = pipeline.read(self.work / "lesson-review-1.request.json")
        self.assertIn("editorialFindings", request["payload"])
        self.assertEqual(request["payload"]["editorialFindings"]["candidateSha256"],
                         pipeline.file_sha(self.work / "lesson-draft-1.json"))
        self.assertTrue(pipeline.verify_ready(self.ready_receipt(), self.bundle, self.work))
        notes = pipeline.read(self.work / "editorial-findings.json")
        notes["findings"].append("An additional substantive question was never seen by the reviewer.")
        write_json(self.work / "editorial-findings.json", notes)
        with self.assertRaisesRegex(ValueError, "exact source/proposal/images"):
            pipeline.verify_ready(self.ready_receipt(), self.bundle, self.work)
        notes["candidateSha256"] = "0" * 64
        write_json(self.work / "editorial-findings.json", notes)
        with self.assertRaisesRegex(ValueError, "inspected draft"):
            pipeline.verify_ready(self.ready_receipt(), self.bundle, self.work)

    def test_precise_manual_fields_keep_raw_draft_and_require_full_independent_review(self):
        def author_then_editor(prompt, payload, schema, attachments, path, timeout):
            result = self.fake_model(prompt, payload, schema, attachments, path, timeout)
            if "sections" in schema["properties"]:
                write_json(self.work / "editorial-patch.json", {
                    "version": 1, "sourceSetSha256": self.bundle["sourceSetSha256"],
                    "unitId": self.bundle["chapter"]["unitId"], "baseFile": Path(path).name,
                    "baseSha256": pipeline.file_sha(path), "baseCandidateSha256": contract.value_sha(result),
                    "changes": [{"path": ["goal"], "before": result["goal"],
                        "after": result["goal"] + " Отдельно объясните выбор адресата и форму своего сообщения.",
                        "reason": "Clarify the authentic communication goal before independent review."}]})
            return result

        with patch.object(pipeline, "call_model", side_effect=author_then_editor):
            pipeline.run_chapter(self.bundle, self.work, timeout=10)
        self.assertEqual(self.author_count, 1, "A precise field edit unnecessarily redrafted the chapter")
        raw = pipeline.read(self.work / "lesson-draft-1.json")
        receipt = self.ready_receipt()
        self.assertNotEqual(receipt["lesson"]["goal"], raw["goal"])
        expected = deepcopy(raw)
        expected["goal"] = receipt["lesson"]["goal"]
        self.assertEqual(receipt["lesson"], expected)
        review = pipeline.read(self.work / "lesson-review-1.request.json")
        self.assertEqual(review["payload"]["candidate"], expected)
        self.assertEqual(review["payload"]["editorialPatch"], receipt["editorialPatch"])
        self.assertTrue(pipeline.verify_ready(receipt, self.bundle, self.work))
        changed = pipeline.read(self.work / "editorial-patch.json")
        changed["changes"][0]["after"] += " Новая непроверенная правка."
        write_json(self.work / "editorial-patch.json", changed)
        with self.assertRaisesRegex(ValueError, "final reviewed receipt"):
            pipeline.verify_ready(receipt, self.bundle, self.work)

    def test_shared_quota_pause_preserves_inflight_draft_and_blocks_next_model_stage(self):
        paused = threading.Event()
        pipeline.CALL_CONTEXT.provider_stop = paused
        self.addCleanup(lambda: delattr(pipeline.CALL_CONTEXT, "provider_stop"))

        def finish_then_pause(*args, **kwargs):
            result = self.fake_model(*args, **kwargs)
            paused.set()
            return result

        with patch.object(pipeline, "call_model", side_effect=finish_then_pause), \
                self.assertRaisesRegex(pipeline.QuotaReached, "next model stage"):
            pipeline.run_chapter(self.bundle, self.work, timeout=10)
        self.assertEqual(len(self.calls), 1)
        original_draft = (self.work / "analysis-draft-1.json").read_bytes()
        self.assertFalse((self.work / "analysis-review-1.json").exists())
        self.assertFalse((self.work / "verified.json").exists())
        paused.clear()
        self.assertEqual(self.run_offline()["status"], "verified")
        self.assertEqual(len(self.calls), 4)
        self.assertEqual((self.work / "analysis-draft-1.json").read_bytes(), original_draft)

    def test_analysis_request_keeps_full_source_candidates_and_every_image(self):
        request = pipeline.build_analysis_request(self.bundle)
        serialized = json.dumps(request["payload"], ensure_ascii=False)
        self.assertEqual(request["payload"]["source"], self.bundle["source"])
        self.assertIn("Organizing and supporting a paragraph", serialized)
        self.assertIn(self.bundle["source"]["supportingSources"][0]["text"], serialized)
        for image in self.bundle["attachments"]:
            self.assertIn(image["id"], serialized)
            self.assertIn(image["sha256"], serialized)
        pipeline.validate_analysis(deepcopy(self.analysis), self.bundle)

    def test_source_only_stage_stops_before_lesson_and_full_stage_resumes_same_reviewed_analysis(self):
        with patch.object(pipeline, "call_model", side_effect=self.fake_model):
            result = pipeline.analyze_chapter(self.bundle, self.work, timeout=10)
        self.assertEqual(result["status"], "analysis-verified")
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(self.author_count, 0)
        self.assertFalse((self.work / "verified.json").exists())
        self.assertFalse((self.work / "lesson.json").exists())
        self.assertEqual(list(self.work.glob("lesson-*.json")), [])
        receipt = pipeline.read(self.work / "analysis-verified.json")
        pipeline.verify_analysis_ready(receipt, self.bundle, self.work)
        with patch.object(pipeline, "call_model", side_effect=AssertionError("source resume invoked a model")):
            self.assertEqual(pipeline.analyze_chapter(self.bundle, self.work)["status"], "analysis-resumed")
        original_receipt = (self.work / "analysis-verified.json").read_bytes()
        self.assertEqual(self.run_offline()["status"], "verified")
        self.assertEqual(len(self.calls), 4)
        self.assertEqual(self.author_count, 1)
        self.assertEqual((self.work / "analysis-verified.json").read_bytes(), original_receipt)
        self.assertEqual(self.ready_receipt()["analysisAcceptance"], receipt["analysisAcceptance"])

    def test_source_only_acceptance_tampering_blocks_lesson_before_any_author_call(self):
        with patch.object(pipeline, "call_model", side_effect=self.fake_model):
            pipeline.analyze_chapter(self.bundle, self.work, timeout=10)
        receipt_path = self.work / "analysis-verified.json"
        receipt = pipeline.read(receipt_path)
        receipt["analysis"]["requiredPoints"][0]["point"] += " Unreviewed substantive addition."
        receipt["analysisSha256"] = contract.value_sha(receipt["analysis"])
        write_json(receipt_path, receipt)
        write_json(self.work / "analysis.json", receipt["analysis"])
        with patch.object(pipeline, "call_model") as model, self.assertRaises(ValueError):
            pipeline.run_chapter(self.bundle, self.work, timeout=10)
        model.assert_not_called()
        self.assertFalse((self.work / "verified.json").exists())

    def test_analysis_requires_complete_unique_image_coverage(self):
        for coverage in ([], self.analysis["pageCoverage"][:1],
                         self.analysis["pageCoverage"] + self.analysis["pageCoverage"][:1]):
            candidate = deepcopy(self.analysis)
            candidate["pageCoverage"] = deepcopy(coverage)
            with self.subTest(coverage=coverage), self.assertRaises(ValueError):
                pipeline.validate_analysis(candidate, self.bundle)
        candidate = deepcopy(self.analysis)
        candidate["pageCoverage"][0]["observations"] = ""
        with self.assertRaises(ValueError):
            pipeline.validate_analysis(candidate, self.bundle)

    def test_analysis_requires_heading_mapping_and_real_known_points(self):
        mutations = [lambda value: value.update(headingCoverage=[]),
                     lambda value: value["headingCoverage"][0].update(pointIds=["missing-point"]),
                     lambda value: value.update(requiredPoints=[]),
                     lambda value: value["requiredPoints"][0].update(pages=[999])]
        for mutate in mutations:
            candidate = deepcopy(self.analysis)
            mutate(candidate)
            with self.subTest(candidate=candidate), self.assertRaises(ValueError):
                pipeline.validate_analysis(candidate, self.bundle)

    def test_analysis_rejects_wrong_unit_hash_and_unresolved_source(self):
        for key, value in (("unitId", "another-unit"), ("bundleSha256", "0" * 64),
                           ("unresolved", ["Cannot read the table on the second supplied page."])):
            candidate = deepcopy(self.analysis)
            candidate[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                pipeline.validate_analysis(candidate, self.bundle)

    def test_unsupported_source_format_is_rejected_before_model_calls(self):
        bundle = deepcopy(self.bundle)
        bundle["source"]["source"] = "Local_Book.pdf"
        bundle["sourceSetSha256"] = contract.value_sha({k: v for k, v in bundle.items() if k != "sourceSetSha256"})
        with self.assertRaisesRegex(ValueError, "extraction format"):
            pipeline.run_chapter(bundle, self.work)

    def test_source_image_tampering_is_rejected_before_any_model_call(self):
        image = Path(self.bundle["attachments"][0]["path"])
        image.write_bytes(b"\xff\xd8changed image\xff\xd9")
        with patch.object(pipeline, "call_model") as model, self.assertRaises(ValueError):
            pipeline.run_chapter(self.bundle, self.work, timeout=10)
        model.assert_not_called()

    def test_source_text_file_tampering_is_rejected_before_any_model_call(self):
        source = Path(self.bundle["sourceFiles"][0]["path"])
        source.write_text('{"text":"changed after intake"}', encoding="utf-8")
        with patch.object(pipeline, "call_model") as model, self.assertRaises(ValueError):
            pipeline.run_chapter(self.bundle, self.work, timeout=10)
        model.assert_not_called()

    def test_bundle_metadata_tampering_breaks_the_source_set_binding(self):
        self.bundle["source"]["text"] += " Different unbound source material."
        with patch.object(pipeline, "call_model") as model, self.assertRaises(ValueError):
            pipeline.run_chapter(self.bundle, self.work, timeout=10)
        model.assert_not_called()

    def test_unit_scoped_audio_registry_ignores_other_units_but_binds_own_transcript(self):
        registry_path = self.root / "approved-audio.json"
        unit_id = self.bundle["chapter"]["unitId"]
        transcript = "I chose the blue notebook for the meeting."
        own_unit = [{"id": "approved-track-1", "text": transcript,
                     "transcriptSha256": contract.text_sha(transcript)}]
        registry = {"units": {unit_id: deepcopy(own_unit), "other-unit": []}}
        write_json(registry_path, registry)
        self.bundle["sourceFiles"].append({"path": str(registry_path), "selector": "json-unit",
            "unitId": unit_id, "sha256": contract.value_sha(own_unit)})
        self.bundle["approvedMaterials"] = deepcopy(own_unit)
        self.bundle["sourceSetSha256"] = contract.value_sha({
            key: value for key, value in self.bundle.items() if key != "sourceSetSha256"})
        original_bundle = deepcopy(self.bundle)
        original_file_sha = pipeline.file_sha(registry_path)
        pipeline.validate_bundle(self.bundle)

        registry["units"]["newly-prepared-unit"] = [{"text": "A different chapter's new transcript."}]
        write_json(registry_path, registry)
        self.assertNotEqual(pipeline.file_sha(registry_path), original_file_sha)
        pipeline.validate_bundle(self.bundle)
        self.assertEqual(self.bundle, original_bundle)

        registry["units"]["other-unit"] = [{"text": "A revised transcript for another unit."}]
        write_json(registry_path, registry)
        pipeline.validate_bundle(self.bundle)
        self.assertEqual(self.bundle, original_bundle)

        registry["units"][unit_id][0]["text"] = "The selected chapter transcript was changed."
        registry["units"][unit_id][0]["transcriptSha256"] = contract.text_sha(registry["units"][unit_id][0]["text"])
        write_json(registry_path, registry)
        with self.assertRaises(ValueError):
            pipeline.validate_bundle(self.bundle)

    def test_selected_intake_binding_ignores_unrelated_metadata_but_binds_unit_and_used_companion(self):
        book_id, unit_id, companion_id = "great-writing-4-4", "great-writing-4-4-001", "great-writing-4-notes"
        unit = {"id": unit_id, "unit": 1, "title": "Comparison of clear supporting ideas", "pages": [12, 13],
                "companionUnits": [{"companionId": companion_id, "pages": [5]}], "audioTracks": []}
        book = {"id": book_id, "title": "Great Writing 4", "edition": "Fourth Edition",
                "filename": "fixture-student.pdf", "sha256": "c" * 64,
                "units": [unit, {"id": "great-writing-4-4-002", "unit": 2, "title": "Other unit", "pages": [14]}]}
        companion = {"id": companion_id, "sha256": "d" * 64, "kind": "teacher-notes", "filename": "fixture-teacher.pdf"}
        manifest = {"books": [book, {"id": "unrelated-book", "title": "Other book", "units": []}],
                    "companions": [companion, {"id": "unused-companion", "kind": "workbook"}],
                    "audio": [{"id": "global-audio-summary", "status": "preparing"}], "totalUnits": 2}
        manifest_path = self.root / "intake.json"
        write_json(manifest_path, manifest)
        images = [{"page": image["page"], "path": Path(image["path"]).relative_to(self.root).as_posix(),
                   "sha256": image["sha256"]} for image in self.bundle["attachments"] if image["role"] == "chapter"]
        pack = {**deepcopy(self.bundle["source"]), "unitId": unit_id, "bookId": book_id,
                "title": unit["title"], "companionUnits": deepcopy(unit["companionUnits"]), "audioTracks": [],
                "provenance": {"sha256": book["sha256"], "sourceHash": contract.text_sha(self.bundle["source"]["text"]),
                               "sourceImages": images}}
        write_json(self.root / "units" / (unit_id + ".json"), pack)
        teacher_image = self.bundle["attachments"][-1]
        teacher = {"companionId": companion_id, "unit": 1, "filename": companion["filename"],
                   "sha256": companion["sha256"], "pages": [5], "text": "Teacher comparison and support notes.",
                   "pageTexts": [{"page": 5, "text": "Teacher comparison and support notes.",
                       "image": Path(teacher_image["path"]).relative_to(self.root).as_posix(),
                       "imageSHA256": teacher_image["sha256"]}], "warnings": []}
        write_json(self.root / "companions" / companion_id / "units" / "001.json", teacher)

        def load_current():
            current = pipeline.read(manifest_path)
            selected_book = current["books"][0]
            return pipeline.load_bundle(selected_book, selected_book["units"][0], self.root, manifest_path)

        original = load_current()
        queued_book = deepcopy(book)
        queued_unit = deepcopy(unit)
        baseline_hash = original["sourceSetSha256"]
        manifest["books"][0]["units"][1]["title"] = "Another unit was revised"
        manifest["books"][1]["title"] = "Another book was revised"
        manifest["audio"][0]["status"] = "more unrelated audio prepared"
        manifest["companions"][1]["kind"] = "unused companion metadata changed"
        write_json(manifest_path, manifest)
        pipeline.validate_bundle(original)
        self.assertEqual(load_current()["sourceSetSha256"], baseline_hash)
        # A deferred audio worker retains its original inventory object while
        # another unit's metadata can change in the live manifest.
        self.assertEqual(pipeline.load_bundle(queued_book, queued_unit, self.root,
            manifest_path)["sourceSetSha256"], baseline_hash)

        for target in ("selected-unit", "used-companion"):
            changed = deepcopy(manifest)
            if target == "selected-unit":
                changed["books"][0]["units"][0]["title"] = "Changed selected teaching scope"
            else:
                changed["companions"][0]["kind"] = "changed used companion classification"
            write_json(manifest_path, changed)
            with self.subTest(target=target), self.assertRaises(ValueError):
                pipeline.validate_bundle(original)
            self.assertNotEqual(load_current()["sourceSetSha256"], baseline_hash)
            if target == "selected-unit":
                with self.assertRaisesRegex(ValueError, "metadata differs"):
                    pipeline.load_bundle(queued_book, queued_unit, self.root, manifest_path)

    def test_complete_offline_workflow_has_fresh_exact_reviews_and_resumes_without_cli(self):
        result = self.run_offline()
        self.assertEqual(result["status"], "verified")
        receipt = self.ready_receipt()
        pipeline.verify_ready(receipt, self.bundle, self.work)
        self.assertEqual(len(self.calls), 4)
        analyses = [call for call in self.calls if "requiredPoints" in call["schema"]["properties"]]
        authors = [call for call in self.calls if "sections" in call["schema"]["properties"]]
        reviews = [call for call in self.calls if "decision" in call["schema"]["properties"]]
        self.assertEqual((len(analyses), len(authors), len(reviews)), (1, 1, 2))
        for call in self.calls:
            self.assertEqual([image["id"] for image in call["attachments"]],
                             [image["id"] for image in self.bundle["attachments"]])
        for review in reviews:
            self.assertEqual(review["payload"]["candidateSha256"],
                             contract.value_sha(review["payload"]["candidate"]))
        with patch.object(pipeline, "call_model", side_effect=AssertionError("resume called the model")) as model:
            resumed = pipeline.run_chapter(self.bundle, self.work, timeout=10)
        model.assert_not_called()
        self.assertEqual(resumed["status"], "resumed")
        self.assertEqual(resumed["file"], result["file"])
        self.assertEqual(receipt, self.ready_receipt())

    def test_per_unit_additional_evidence_keeps_other_sources_stable_and_binds_every_added_page(self):
        chapter = self.bundle["chapter"]
        unit = {"id": chapter["unitId"], "unit": 3, "title": chapter["title"], "pages": chapter["pages"]}
        book = {"id": "great-writing-4-4", "title": chapter["bookTitle"], "edition": "Fourth Edition",
            "filename": "student-fixture.pdf", "sha256": "c" * 64, "units": [unit]}
        manifest_path = self.root / "intake.json"
        write_json(manifest_path, {"books": [book], "companions": []})
        images = [{"page": item["page"], "path": Path(item["path"]).relative_to(self.root).as_posix(),
            "sha256": item["sha256"]} for item in self.bundle["attachments"] if item["role"] == "chapter"]
        pack = {**deepcopy(self.bundle["source"]), "bookId": book["id"], "provenance": {"sha256": book["sha256"],
            "sourceHash": contract.text_sha(self.bundle["source"]["text"]), "sourceImages": images}}
        write_json(self.root / "units" / (unit["id"] + ".json"), pack)
        load = lambda: pipeline.load_bundle(book, unit, self.root, manifest_path)
        original = load()
        self.assertEqual(pipeline.current_bundle(original), original)
        manifest_bytes = manifest_path.read_bytes()
        write_json(self.root / "lesson-evidence" / "another-unit.json", {"unrelated": "source metadata"})
        self.assertEqual(load(), original)
        self.assertEqual(pipeline.current_bundle(original), original)

        image_path = self.root / "prerequisite-29.jpg"
        image_path.write_bytes(Path(self.bundle["attachments"][0]["path"]).read_bytes())
        prerequisite = {"page": 29, "text": "Four prerequisite paragraph features from the earlier chapter.",
            "image": image_path.name, "imageSHA256": pipeline.file_sha(image_path)}
        write_json(self.root / book["id"] / "pages.json", {"sha256": book["sha256"], "pages": [prerequisite]})
        pdf_path = self.root / "official-peer-sheet.pdf"
        pdf_path.write_bytes(b"%PDF-1.4\nprivate offline source-identity fixture\n%%EOF")
        sheet_image = self.root / "peer-sheet-4.jpg"
        sheet_image.write_bytes(Path(self.bundle["attachments"][1]["path"]).read_bytes())
        external = {"id": "official-peer-sheet-three", "title": "Unit three peer worksheet", "kind": "peer-editing-sheet",
            "sourceUrl": "https://example.org/official-peer-sheet.pdf", "sourceFile": pdf_path.name,
            "sourceSha256": pipeline.file_sha(pdf_path), "pages": [4], "pageTexts": [
                {"page": 4, "text": "The original worksheet checks unity and gives a concrete reader question.",
                 "image": sheet_image.name, "imageSHA256": pipeline.file_sha(sheet_image)}]}
        evidence = {"version": 1, "unitId": unit["id"], "bookId": book["id"],
            "studentSupplementPages": {"paragraph-feature-prerequisite": [29]},
            "externalSources": [external], "notes": ["This supplied sheet matches the cited unit and activity."]}
        evidence_path = self.root / "lesson-evidence" / (unit["id"] + ".json")
        write_json(evidence_path, evidence)
        augmented = load()
        self.assertEqual(pipeline.current_bundle(original), augmented)
        self.assertNotEqual(augmented["sourceSetSha256"], original["sourceSetSha256"])
        self.assertEqual(manifest_path.read_bytes(), manifest_bytes)
        self.assertEqual(augmented["source"]["text"], original["source"]["text"])
        self.assertEqual(augmented["chapter"]["pages"], chapter["pages"])
        self.assertEqual([(item["page"], item["role"]) for item in augmented["attachments"][-2:]],
            [(29, "supplement"), (4, "external-evidence")])
        request_text = json.dumps(pipeline.model_input(augmented), ensure_ascii=False)
        self.assertIn(prerequisite["text"], request_text)
        self.assertIn(external["pageTexts"][0]["text"], request_text)
        self.assertIn(external["sourceUrl"], request_text)
        self.assertIn(evidence["notes"][0], request_text)
        pipeline.validate_bundle(augmented)
        pdf_path.write_bytes(b"Changed external source after review")
        with self.assertRaises(ValueError):
            pipeline.validate_bundle(augmented)
        with self.assertRaisesRegex(ValueError, "SHA256"):
            load()
        escaped = deepcopy(evidence)
        escaped["externalSources"][0]["sourceFile"] = "../outside.pdf"
        write_json(evidence_path, escaped)
        with self.assertRaisesRegex(ValueError, "escapes"):
            load()

    def test_equivalent_source_binding_reuses_only_unverified_analysis_and_reviews_it_fresh(self):
        sibling = self.work.parent / "obsolete-coarse-selector"
        old_bundle = deepcopy(self.bundle)
        old_bundle["sourceFiles"] = [{"path": "obsolete-intake-checksum-only", "sha256": "a" * 64}]
        old_bundle["sourceSetSha256"] = contract.value_sha({k: v for k, v in old_bundle.items() if k != "sourceSetSha256"})
        old_analysis = deepcopy(self.analysis)
        old_analysis["bundleSha256"] = old_bundle["sourceSetSha256"]
        write_json(sibling / "source-bundle.json", old_bundle)
        write_json(sibling / "analysis.json", old_analysis)
        result = self.run_offline()
        self.assertEqual(result["status"], "verified")
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(self.calls[0]["payload"]["candidate"], self.analysis)
        self.assertEqual(self.calls[0]["payload"]["inputSha256"], self.bundle["sourceSetSha256"])
        self.assertFalse((self.work / "analysis-draft-1.json").exists())
        self.assertFalse((self.work / "analysis-draft-1.request.json").exists())
        seed = pipeline.read(self.work / "analysis-seed.json")
        self.assertTrue(seed["independentReviewRequired"])
        self.assertEqual(seed["candidate"], self.analysis)
        receipt = self.ready_receipt()
        self.assertEqual(receipt["analysisAcceptance"]["file"], "analysis-review-1.json")
        pipeline.verify_ready(receipt, self.bundle, self.work)

    def test_ready_cache_does_not_hide_changed_source_image(self):
        self.run_offline()
        receipt = self.ready_receipt()
        Path(self.bundle["attachments"][0]["path"]).write_bytes(b"\xff\xd8replaced\xff\xd9")
        with self.assertRaises(ValueError):
            pipeline.verify_ready(receipt, self.bundle, self.work)
        with patch.object(pipeline, "call_model") as model, self.assertRaises(ValueError):
            pipeline.run_chapter(self.bundle, self.work, timeout=10)
        model.assert_not_called()

    def test_cache_binds_prompt_payload_schema_and_actual_attachment_bytes(self):
        request = pipeline.build_analysis_request(self.bundle)
        checkpoint = self.work / "analysis-draft-1.json"
        with patch.object(pipeline, "call_model", side_effect=self.fake_model) as model:
            first = pipeline.cached_call(checkpoint, **request,
                attachments=self.bundle["attachments"], timeout=10)
            self.assertEqual(pipeline.cached_call(checkpoint, **request,
                attachments=self.bundle["attachments"], timeout=10), first)
            self.assertEqual(model.call_count, 1)
            for key in ("prompt", "payload", "schema"):
                changed = deepcopy(request)
                if key == "prompt":
                    changed[key] += " Changed instructions."
                elif key == "payload":
                    changed[key]["source"]["text"] += " Changed source."
                else:
                    changed[key]["properties"]["requiredPoints"]["maxItems"] -= 1
                with self.subTest(changed=key), self.assertRaisesRegex(ValueError, "Changed model checkpoint"):
                    pipeline.cached_call(checkpoint, **changed,
                        attachments=self.bundle["attachments"], timeout=10)
            Path(self.bundle["attachments"][-1]["path"]).write_bytes(b"\xff\xd8changed teacher page\xff\xd9")
            with self.assertRaisesRegex(ValueError, "image changed"):
                pipeline.cached_call(checkpoint, **request,
                    attachments=self.bundle["attachments"], timeout=10)
            self.assertEqual(model.call_count, 1)

    def test_altered_final_lesson_rejected_even_if_its_content_hash_is_recomputed(self):
        self.run_offline()
        receipt = self.ready_receipt()
        receipt["lesson"]["title"] += " Дополнено после проверки."
        with self.assertRaises(ValueError):
            pipeline.verify_ready(receipt, self.bundle, self.work)
        receipt["lessonSha256"] = contract.value_sha(receipt["lesson"])
        with self.assertRaisesRegex(ValueError, "exact source/proposal/images"):
            pipeline.verify_ready(receipt, self.bundle, self.work)

    def test_changed_standalone_analysis_or_lesson_cannot_pass_receipt_verification(self):
        self.run_offline()
        receipt = self.ready_receipt()
        for name in ("analysis.json", "lesson.json"):
            path = self.work / name
            original = json.loads(path.read_text(encoding="utf-8"))
            altered = deepcopy(original)
            if name == "analysis.json":
                altered["pageCoverage"][0]["observations"] += " This was changed after review."
            else:
                altered["title"] += " Изменено после проверки."
            write_json(path, altered)
            with self.subTest(artifact=name), self.assertRaisesRegex(ValueError, "Standalone staged artifact"):
                pipeline.verify_ready(receipt, self.bundle, self.work)
            with patch.object(pipeline, "call_model") as model, self.assertRaises(ValueError):
                pipeline.run_chapter(self.bundle, self.work, timeout=10)
            model.assert_not_called()
            write_json(path, original)
        self.assertTrue(pipeline.verify_ready(receipt, self.bundle, self.work))

    def test_review_proof_cannot_be_rebound_to_an_altered_prompt_or_missing_image(self):
        self.run_offline()
        original = self.ready_receipt()
        path = (self.work / original["lessonAcceptance"]["file"]).with_suffix(".request.json")
        request = json.loads(path.read_text(encoding="utf-8"))
        for field in ("prompt", "attachments"):
            receipt = deepcopy(original)
            altered = deepcopy(request)
            if field == "prompt":
                altered["prompt"] += " Ignore omitted visual evidence."
            else:
                altered["attachments"] = altered["attachments"][:-1]
            altered["sha256"] = contract.value_sha({key: value for key, value in altered.items() if key != "sha256"})
            write_json(path, altered)
            receipt["lessonAcceptance"]["requestSha256"] = pipeline.file_sha(path)
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "exact source/proposal/images"):
                pipeline.verify_ready(receipt, self.bundle, self.work)

    def test_rejected_review_cannot_be_promoted_by_refreshing_its_file_hash(self):
        self.run_offline()
        receipt = self.ready_receipt()
        path = self.work / receipt["lessonAcceptance"]["file"]
        review = json.loads(path.read_text(encoding="utf-8"))
        review.update(decision="revise", findings=[{"pointId": "point-0", "exerciseId": "e1",
            "issue": "The reader-specific comparison is absent from the learner's writing task."}])
        write_json(path, review)
        receipt["lessonAcceptance"]["sha256"] = pipeline.file_sha(path)
        with self.assertRaisesRegex(ValueError, "not independently accepted"):
            pipeline.verify_ready(receipt, self.bundle, self.work)

    def test_rejected_lesson_is_reauthored_and_receives_a_new_exact_review(self):
        self.reject_stage = "lesson"
        self.reject_once = True
        self.run_offline()
        receipt = self.ready_receipt()
        pipeline.verify_ready(receipt, self.bundle, self.work)
        self.assertTrue(self.rejected)
        self.assertEqual(self.author_count, 2)
        reviews = [call for call in self.calls if "requestSha256" in call["schema"]["properties"]]
        self.assertEqual(len(reviews), 2)
        self.assertNotEqual(reviews[0]["payload"]["candidateSha256"],
                            reviews[1]["payload"]["candidateSha256"])
        for review in reviews:
            self.assertEqual(review["payload"]["candidateSha256"],
                             contract.value_sha(review["payload"]["candidate"]))

    def test_never_accepting_review_cannot_create_ready_receipt(self):
        self.reject_stage = "lesson"
        with self.assertRaises((ValueError, RuntimeError)):
            self.run_offline()
        self.assertTrue(self.rejected)
        self.assertFalse((self.work / "verified.json").exists())
        self.assertFalse((self.work / "lesson.json").exists())

    def test_unaccepted_source_analysis_cannot_start_lesson_authoring(self):
        self.reject_stage = "analysis"
        with self.assertRaisesRegex(ValueError, "six independent reviews"):
            self.run_offline()
        self.assertTrue(self.rejected)
        self.assertEqual(self.author_count, 0)
        self.assertFalse((self.work / "verified.json").exists())

    def install_unverified_recovery(self):
        with patch.object(pipeline, "call_model", side_effect=self.fake_model):
            pipeline.run_analysis(self.bundle, self.work, timeout=10)
        base = pipeline.author_request(self.bundle, self.analysis, self.work)
        previous = deepcopy(self.lesson)
        previous["provenance"].update(deepcopy(base["payload"]["requiredProvenance"]))
        previous["materials"][0]["inputSkill"] = "unsupported-mode"
        raw_path = self.work / "lesson-draft-1.json"
        write_json(raw_path, previous)
        write_json(self.work / "lesson-review-1.json", {"decision": "accept", "candidateSha256": "unbound"})
        seed = {"version": 1, "unitId": self.bundle["chapter"]["unitId"],
            "sourceSetSha256": self.bundle["sourceSetSha256"], "baseFile": raw_path.name,
            "baseSha256": pipeline.file_sha(raw_path), "candidateSha256": contract.value_sha(previous),
            "nextDraft": 2, "findings": ["Correct the material classification and recheck every source point in a full new candidate."],
            "reason": "Earlier material metadata failed validation; the complete new candidate still needs independent review."}
        write_json(self.work / "lesson-recovery.json", seed)
        return raw_path, seed

    def test_recovery_skips_unverified_old_cache_and_reviews_complete_new_candidate(self):
        raw_path, seed = self.install_unverified_recovery()
        before = raw_path.read_bytes()
        old_review = (self.work / "lesson-review-1.json").read_bytes()
        self.run_offline()
        receipt = self.ready_receipt()
        self.assertEqual(raw_path.read_bytes(), before)
        self.assertEqual((self.work / "lesson-review-1.json").read_bytes(), old_review)
        self.assertEqual(receipt["lessonAcceptance"]["file"], "lesson-review-2.json")
        self.assertEqual(receipt["recoverySeed"]["status"], "unverified-recovery-seed")
        author = pipeline.read(self.work / "lesson-draft-2.request.json")
        self.assertEqual(author["payload"]["previousCandidate"], pipeline.read(raw_path))
        self.assertEqual(author["payload"]["requiredCorrections"], seed["findings"])
        review = pipeline.read(self.work / "lesson-review-2.request.json")
        self.assertEqual(review["payload"]["candidate"], receipt["lesson"])
        self.assertEqual(review["payload"]["recoverySeed"], receipt["recoverySeed"])
        self.assertTrue(pipeline.verify_ready(receipt, self.bundle, self.work))
        changed = deepcopy(seed)
        changed["findings"].append("An additional observation was introduced after the final accepted review.")
        write_json(self.work / "lesson-recovery.json", changed)
        with self.assertRaises(ValueError):
            pipeline.verify_ready(receipt, self.bundle, self.work)

    def test_recovery_seed_never_replaces_independent_acceptance(self):
        self.install_unverified_recovery()
        self.reject_stage = "lesson"
        with self.assertRaisesRegex(ValueError, "six independent lesson reviews"):
            self.run_offline()
        self.assertFalse((self.work / "verified.json").exists())
        self.assertFalse((self.work / "lesson.json").exists())
        self.assertFalse((self.work / "lesson-draft-1.request.json").exists())

    def test_recovered_author_contract_survives_future_prompt_version_without_rewriting_requests(self):
        self.install_unverified_recovery()
        self.run_offline()
        receipt = self.ready_receipt()
        before = {path.name: path.read_bytes() for path in self.work.glob("*.request.json")}
        original = pipeline.author_request(self.bundle, self.analysis, self.work)
        future_prompt = contract.AUTHOR_PROMPT + "\nFuture precise revision-stage wording for new authors only."
        with patch.object(contract, "AUTHOR_PROMPT", future_prompt), \
                patch.object(contract, "KNOWN_AUTHOR_PROMPTS", (*contract.KNOWN_AUTHOR_PROMPTS, future_prompt)), \
                patch.object(pipeline, "call_model", side_effect=AssertionError("Accepted recovery must not regenerate")):
            current_default = contract.build_request(self.bundle["chapter"], original["payload"]["source"],
                self.analysis["requiredPoints"], original["payload"]["attachedPages"], self.bundle["approvedMaterials"])
            self.assertEqual(current_default["prompt"], future_prompt)
            preserved = pipeline.author_request(self.bundle, self.analysis, self.work)
            self.assertEqual(preserved, original)
            self.assertTrue(pipeline.verify_ready(receipt, self.bundle, self.work))
            self.assertEqual(pipeline.run_chapter(self.bundle, self.work, timeout=10)["status"], "resumed")
        self.assertEqual({path.name: path.read_bytes() for path in self.work.glob("*.request.json")}, before)
        self.assertFalse((self.work / "lesson-draft-1.request.json").exists())

    def test_recovered_author_contract_rejects_changed_original_input_or_repair_findings(self):
        self.install_unverified_recovery()
        self.run_offline()
        path = self.work / "lesson-draft-2.request.json"
        original = pipeline.read(path)
        for mutate in (
                lambda value: value["payload"]["originalInput"].update({"unexpected": "different source"}),
                lambda value: value["payload"]["requiredCorrections"].append("Changed prior repair observations.")):
            changed = deepcopy(original)
            mutate(changed)
            changed["sha256"] = contract.value_sha({key: value for key, value in changed.items() if key != "sha256"})
            write_json(path, changed)
            with self.assertRaises(ValueError):
                pipeline.author_request(self.bundle, self.analysis, self.work)
        write_json(path, original)
        self.assertTrue(pipeline.verify_ready(self.ready_receipt(), self.bundle, self.work))

    def test_declared_audio_without_verified_transcripts_stops_before_lesson_authoring(self):
        self.bundle["declaredAudioTracks"] = [1]
        self.bundle["sourceSetSha256"] = contract.value_sha({
            key: value for key, value in self.bundle.items() if key != "sourceSetSha256"})
        self.analysis["bundleSha256"] = self.bundle["sourceSetSha256"]
        with self.assertRaisesRegex(ValueError, "audio/transcripts are not ready"):
            self.run_offline()
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(self.author_count, 0)
        self.assertFalse((self.work / "verified.json").exists())

    def test_real_model_transport_uses_all_images_full_file_stdin_and_strict_nullable_schema(self):
        checkpoint = self.work / "transport.json"
        schema = contract._object({"title": contract._STRING, "generated": {"const": True},
            "items": contract._array(contract._object({"id": contract._STRING,
                "note": contract._STRING}, ["id"])),
            "audioFile": contract._STRING}, ["title", "generated", "items"])
        original_schema = deepcopy(schema)
        raw = {"title": "Текст сохраняется без исправлений", "generated": True,
               "items": [{"id": "item-1", "note": None}], "audioFile": None}
        expected = {"title": raw["title"], "generated": True, "items": [{"id": "item-1"}]}
        prompt = "Inspect every supplied chapter and companion page."
        payload = {"source": "Full chapter paragraph with punctuation and a Unicode contrast.\n" * 2200,
                   "lastPage": "This final page must also reach the subprocess: сравнение."}
        captured = {}
        process = Mock(returncode=0)

        def popen(command, **kwargs):
            captured["command"] = command
            captured["cwd"] = Path(kwargs["cwd"])
            stdin = kwargs["stdin"]
            self.assertNotEqual(stdin, subprocess.PIPE)
            self.assertTrue(Path(stdin.name).is_file())
            self.assertEqual(Path(stdin.name).parent, captured["cwd"])
            self.assertNotEqual(captured["cwd"], Path.cwd())
            self.assertGreaterEqual(stdin.fileno(), 0)
            captured["input"] = stdin.read()
            self.assertFalse(kwargs.get("shell", False))
            self.assertTrue(kwargs["text"])
            self.assertEqual(kwargs["encoding"], "utf-8")
            if os.name == "nt":
                self.assertEqual(kwargs["creationflags"], subprocess.CREATE_NO_WINDOW)
            schema_path = Path(command[command.index("--output-schema") + 1])
            captured["schema"] = json.loads(schema_path.read_text(encoding="utf-8"))
            output = Path(command[command.index("--output-last-message") + 1])
            write_json(output, raw)
            return process

        with patch.object(pipeline, "codex_command", return_value=["codex-offline-test"]), \
                patch.object(pipeline.subprocess, "Popen", side_effect=popen) as launch:
            value = pipeline.call_model(prompt, payload, schema, self.bundle["attachments"], checkpoint, timeout=10)
        launch.assert_called_once()
        process.wait.assert_called_once_with(timeout=10)
        process.kill.assert_not_called()
        command = captured["command"]
        images = [command[index + 1] for index, argument in enumerate(command) if argument == "--image"]
        self.assertEqual(images, [image["path"] for image in self.bundle["attachments"]])
        self.assertEqual(command[command.index("--sandbox") + 1], "read-only")
        self.assertEqual(command[command.index("--model") + 1], "gpt-6-astra")
        invocation = pipeline.read(checkpoint.with_suffix(".invocation.json"))
        self.assertEqual(invocation["model"], "gpt-6-astra")
        self.assertEqual(invocation["payloadSha256"], contract.value_sha(payload))
        self.assertIn('model_providers.openai-http.requires_openai_auth=true', command)
        self.assertIn('model_providers.openai-http.supports_websockets=false', command)
        self.assertFalse(any('base_url=' in item or 'api_key=' in item for item in command))
        for option in ("--ephemeral", "--ignore-user-config", "--ignore-rules", "features.shell_tool=false",
                       "features.unified_exec=false", 'web_search="disabled"'):
            self.assertIn(option, command)
        self.assertEqual(command[-2:], ["--", "-"])
        expected_input = prompt + "\nINPUT DATA:\n" + json.dumps(payload, ensure_ascii=False)
        self.assertGreater(len(expected_input.encode("utf-8")), 65536)
        self.assertEqual(captured["input"], expected_input)
        self.assertEqual(set(captured["schema"]["required"]), {"title", "generated", "items", "audioFile"})
        self.assertEqual(captured["schema"]["properties"]["generated"], {"type": "boolean", "enum": [True]})
        self.assertEqual(captured["schema"]["properties"]["audioFile"]["anyOf"],
                         [{"type": "string"}, {"type": "null"}])
        nested = captured["schema"]["properties"]["items"]["items"]
        self.assertEqual(set(nested["required"]), {"id", "note"})
        self.assertEqual(nested["properties"]["note"]["anyOf"],
                         [{"type": "string"}, {"type": "null"}])
        self.assertEqual(schema, original_schema)
        self.assertEqual(schema["properties"]["generated"], {"const": True})
        self.assertEqual(value, expected)
        self.assertEqual(pipeline.read(checkpoint), expected)
        self.assertEqual(pipeline.read(checkpoint.with_suffix(".raw.json")), raw)
        self.assertFalse(captured["cwd"].exists(), "Private input transport directory was not cleaned up")

    def test_automated_field_proposal_has_exact_sol_transport_and_requires_new_full_review(self):
        import coursebook_field_repair as fields
        self.run_offline()
        original = pipeline.read(self.work / "verified.json")
        base_file = "lesson-draft-1.json"
        raw = pipeline.read(self.work / base_file)
        findings = [{"path": ["subtitle"], "issue": "Уточнить самостоятельное применение материала главы."}]
        request = fields.build_request(self.bundle, self.work, base_file,
                                       original["analysis"]["requiredPoints"], findings)
        response = {key: request["payload"][key]
                    for key in fields.RESPONSE_SCHEMA["properties"] if key != "changes"}
        response["changes"] = [{"path": ["subtitle"], "before": raw["subtitle"],
            "after": raw["subtitle"] + " с самостоятельным объяснением выбора",
            "reason": "Уточнить цель самостоятельного применения без изменения содержания главы."}]
        proposal = self.work / "lesson-field-repair-1.json"
        captured = {}

        def popen(command, **kwargs):
            captured["model"] = command[command.index("--model") + 1]
            captured["schema"] = pipeline.read(command[command.index("--output-schema") + 1])
            write_json(command[command.index("--output-last-message") + 1], response)
            return Mock(returncode=0)

        with patch.object(pipeline, "codex_command", return_value=["codex-offline-test"]), \
                patch.object(pipeline.subprocess, "Popen", side_effect=popen):
            pipeline.cached_call(proposal, **request, attachments=self.bundle["attachments"], timeout=10)
        self.assertEqual(captured["model"], "gpt-5.6-sol")
        self.assertEqual(captured["schema"]["properties"]["inputSha256"]["enum"],
                         [request["payload"]["inputSha256"]])
        prepared = fields.prepare_patch(self.bundle, self.work, request, proposal)
        write_json(self.work / "editorial-patch.json", prepared["patch"])
        write_json(self.work / "field-repair-proof.json", {"version": 1,
            "proposalFile": proposal.name, "evidence": prepared["evidence"]})
        with self.assertRaises(ValueError):
            pipeline.verify_ready(original, self.bundle, self.work)
        (self.work / "verified.json").unlink()
        base = pipeline.author_request(self.bundle, original["analysis"], self.work)
        review_request = pipeline.lesson_review_request(prepared["candidate"], base, self.bundle, self.work)
        self.assertIn("automated editorial", review_request["prompt"])
        self.assertNotIn("human editorial", review_request["prompt"])
        self.assertEqual(review_request["payload"]["candidate"], prepared["candidate"])
        review_path = self.work / "lesson-review-2.json"
        with patch.object(pipeline, "call_model", side_effect=self.fake_model):
            pipeline.cached_call(review_path,
                **{key: review_request[key] for key in ("prompt", "payload", "schema")},
                attachments=self.bundle["attachments"], timeout=10)
        receipt = deepcopy(original)
        receipt.update(lesson=prepared["candidate"], lessonSha256=contract.value_sha(prepared["candidate"]),
            lessonAcceptance=pipeline.checkpoint_record(review_path),
            editorialPatch=pipeline.load_patch(self.bundle, self.work)[1],
            fieldRepairProposal=pipeline.field_repair_evidence(self.bundle, self.work))
        write_json(self.work / "lesson.json", prepared["candidate"])
        self.assertTrue(pipeline.verify_ready(receipt, self.bundle, self.work))
        changed = deepcopy(response)
        changed["changes"][0]["reason"] += " Изменено после проверки."
        write_json(proposal, changed)
        with self.assertRaises(ValueError):
            pipeline.verify_ready(receipt, self.bundle, self.work)

    def test_persistent_quota_sources_block_new_calls_but_keep_bound_cache_readable(self):
        checkpoint = self.work / "accepted-call.json"
        request = {"prompt": "Read the complete source.", "payload": {"source": "full"},
                   "schema": contract._object({"answer": contract._STRING})}
        response = {"answer": "Previously returned and retained."}

        def returned(prompt, payload, schema, attachments, path, timeout):
            write_json(path, response)
            return response

        with patch.object(pipeline, "call_model", side_effect=returned) as model:
            pipeline.cached_call(checkpoint, **request, attachments=[], timeout=10)
            before = checkpoint.read_bytes()
            model.reset_mock()
            for index, (marker, value) in enumerate((
                    (self.work / "provider-paused.json", {"reason": "local quota"}),
                    (pipeline.WORK / "provider-paused.json", {"reason": "another controller"}),
                    (pipeline.LEXICON_RUN_STATUS, {"providerLimited": True}))):
                with self.subTest(marker=marker):
                    write_json(marker, value)
                    self.assertEqual(pipeline.cached_call(checkpoint, **request,
                        attachments=[], timeout=10), response)
                    with self.assertRaises(pipeline.QuotaReached):
                        pipeline.cached_call(self.work / f"new-{index}.json", **request,
                                             attachments=[], timeout=10)
                    marker.unlink()
            model.assert_not_called()
            self.assertEqual(checkpoint.read_bytes(), before)
            write_json(pipeline.LEXICON_RUN_STATUS, {"providerLimited": False, "pauseRequested": True})
            write_json(pipeline.LEXICON_RUN_STATUS.parent / "pause-request.json", {"drain": True})
            self.assertEqual(pipeline.cached_call(self.work / "manual-drain.json", **request,
                attachments=[], timeout=10), response)
            model.assert_called_once()

    def test_final_transport_gate_catches_quota_set_during_preparation(self):
        checkpoint = self.work / "launch-race.json"
        paused = threading.Event()
        pipeline.CALL_CONTEXT.provider_stop = paused
        self.addCleanup(lambda: delattr(pipeline.CALL_CONTEXT, "provider_stop"))

        def prepare_command():
            pipeline.signal_provider_pause(checkpoint)
            return ["codex-offline-test"]

        with patch.object(pipeline, "codex_command", side_effect=prepare_command), \
                patch.object(pipeline.subprocess, "Popen") as launch, \
                self.assertRaises(pipeline.QuotaReached):
            pipeline.cached_call(checkpoint, "Read all pages.", {"source": "full"},
                contract._object({"answer": contract._STRING}), self.bundle["attachments"], 10)
        launch.assert_not_called()
        self.assertTrue(paused.is_set())
        self.assertTrue((self.work / "provider-paused.json").exists())
        self.assertTrue((pipeline.WORK / "provider-paused.json").exists())
        self.assertFalse(checkpoint.exists())

    def test_start_and_quota_signal_share_lock_but_inflight_wait_and_checkpoint_do_not(self):
        checkpoint = self.work / "inflight.json"
        signaling, signaled = threading.Event(), threading.Event()
        pause_threads = []
        process = Mock(returncode=0)

        def signal():
            signaling.set()
            pipeline.signal_provider_pause(checkpoint)
            signaled.set()

        def popen(command, **kwargs):
            write_json(command[command.index("--output-last-message") + 1], {"answer": "Completed inflight result."})
            thread = threading.Thread(target=signal)
            pause_threads.append(thread)
            thread.start()
            self.assertTrue(signaling.wait(1))
            self.assertFalse(signaled.wait(0.02), "Quota signal bypassed the process-start lock")
            return process

        def wait(timeout):
            self.assertTrue(signaled.wait(1), "Process-start lock was held during model wait")

        process.wait.side_effect = wait
        with patch.object(pipeline, "codex_command", return_value=["codex-offline-test"]), \
                patch.object(pipeline.subprocess, "Popen", side_effect=popen):
            result = pipeline.cached_call(checkpoint, "Read all pages.", {"source": "full"},
                contract._object({"answer": contract._STRING}), self.bundle["attachments"], 10)
        for thread in pause_threads:
            thread.join(timeout=1)
            self.assertFalse(thread.is_alive())
        self.assertEqual(result, {"answer": "Completed inflight result."})
        self.assertEqual(pipeline.read(checkpoint), result)
        with patch.object(pipeline, "call_model") as model:
            self.assertEqual(pipeline.cached_call(checkpoint, "Read all pages.", {"source": "full"},
                contract._object({"answer": contract._STRING}), self.bundle["attachments"], 10), result)
        model.assert_not_called()

    def test_detected_transport_quota_sets_event_and_shared_markers_without_retry(self):
        checkpoint = self.work / "quota-call.json"
        paused = threading.Event()
        pipeline.CALL_CONTEXT.provider_stop = paused
        self.addCleanup(lambda: delattr(pipeline.CALL_CONTEXT, "provider_stop"))
        with patch.object(pipeline, "call_model", side_effect=RuntimeError("usage limit reached")) as model, \
                self.assertRaises(pipeline.QuotaReached):
            pipeline.cached_call(checkpoint, "Read source.", {"source": "full"},
                                 contract._object({"answer": contract._STRING}), [], 10)
        model.assert_called_once()
        self.assertTrue(paused.is_set())
        self.assertTrue((self.work / "provider-paused.json").exists())
        self.assertTrue((pipeline.WORK / "provider-paused.json").exists())
        nested = self.work / "units" / "unit-one" / "source-sha" / "draft.json"
        self.assertEqual(pipeline.local_provider_circuit(nested), self.work / "provider-paused.json")

    def test_transport_schema_types_native_lesson_constants_without_mutating_contract(self):
        native = deepcopy(contract.LESSON_SCHEMA)
        before = deepcopy(native)
        transport = pipeline.strict_model_schema(native)
        self.assertEqual(transport["properties"]["generated"], {"type": "boolean", "enum": [True]})
        self.assertEqual(transport["properties"]["provenance"]["properties"]["visualSourceUsed"],
                         {"type": "boolean", "enum": [True]})
        self.assertEqual(native, before)
        self.assertEqual(contract.LESSON_SCHEMA, before)

    def test_real_model_timeout_kills_and_reaps_process_without_creating_candidate(self):
        checkpoint = self.work / "timeout.json"
        process = Mock(returncode=None)
        process.wait.side_effect = [subprocess.TimeoutExpired(["codex-offline-test"], 10), None]
        with patch.object(pipeline, "codex_command", return_value=["codex-offline-test"]), \
                patch.object(pipeline.subprocess, "Popen", return_value=process), \
                self.assertRaises(subprocess.TimeoutExpired):
            pipeline.call_model("Read source.", {"text": "full text"},
                contract._object({"answer": contract._STRING}), self.bundle["attachments"], checkpoint, timeout=10)
        process.kill.assert_called_once_with()
        self.assertEqual(process.wait.call_args_list, [call(timeout=10), call()])
        self.assertFalse(checkpoint.exists())
        self.assertFalse(checkpoint.with_suffix(".raw.json").exists())

    def test_real_model_transport_rejects_source_image_changed_during_call(self):
        checkpoint = self.work / "changed-image.json"
        process = Mock(returncode=0)

        def popen(command, **kwargs):
            write_json(command[command.index("--output-last-message") + 1], {"answer": "Unchanged model answer."})
            Path(self.bundle["attachments"][-1]["path"]).write_bytes(b"\xff\xd8changed during call\xff\xd9")
            return process

        with patch.object(pipeline, "codex_command", return_value=["codex-offline-test"]), \
                patch.object(pipeline.subprocess, "Popen", side_effect=popen), \
                self.assertRaisesRegex(ValueError, "image changed during model call"):
            pipeline.call_model("Read source.", {"text": "full text"},
                contract._object({"answer": contract._STRING}), self.bundle["attachments"], checkpoint, timeout=10)
        self.assertFalse(checkpoint.exists())
        self.assertEqual(pipeline.read(checkpoint.with_suffix(".raw.json")), {"answer": "Unchanged model answer."})


class WorkerOrchestrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name) / "bulk"
        isolate_provider_files(self, self.temp.name)
        self.inventory = [({"id": "fixture-book"}, {"id": f"unit-{index:03d}", "pages": [1, 2]})
                          for index in range(9)]
        self.bundles = {unit["id"]: {"chapter": {"unitId": unit["id"]},
            "source": {"text": "PRIVATE SOURCE BODY MUST NEVER APPEAR IN RUN STATUS", "supportingSources": []},
            "declaredAudioTracks": [], "approvedMaterials": [], "attachments": [],
            "sourceSetSha256": contract.text_sha(unit["id"])} for _, unit in self.inventory}

    def bundle_loader(self, book, unit, *args):
        return deepcopy(self.bundles[unit["id"]])

    def successful_worker(self, bundle, folder, timeout):
        return {"unitId": bundle["chapter"]["unitId"], "status": "verified",
                "file": str(folder / "verified.json")}

    def run_main(self, count=1, workers=1, loader=None, worker=None, pilot=True, extra=()):
        argv = ["--generate", "--work", str(self.work), "--workers", str(workers), *extra]
        with patch.object(pipeline, "load_inventory", return_value=self.inventory[:count]), \
                patch.object(pipeline, "load_bundle", side_effect=loader or self.bundle_loader), \
                patch.object(pipeline, "run_chapter", side_effect=worker or self.successful_worker), \
                patch.object(pipeline, "accepted_pilot", return_value={"unitId": "accepted-pilot"} if pilot else None), \
                redirect_stdout(io.StringIO()):
            return pipeline.main(argv)

    def status(self):
        return pipeline.read(self.work / "run-status.json")

    def test_multiple_units_or_workers_require_a_whole_verified_pilot(self):
        for count, workers in ((2, 1), (1, 2), (9, 8)):
            with self.subTest(count=count, workers=workers), self.assertRaisesRegex(ValueError, "verified pilot"):
                self.run_main(count=count, workers=workers, pilot=False,
                    worker=lambda *args: self.fail("Pilot gate dispatched a chapter"))
        self.assertEqual(self.run_main(count=1, workers=1, pilot=False), 0)

    def test_pilot_gate_verifies_its_stored_bundle_and_rejects_broken_receipts(self):
        folder = self.work / "units" / "pilot" / "old-source-selector"
        receipt = {"unitId": "pilot"}
        stored_bundle = {"selector": "the-pilot-own-stored-bundle"}
        write_json(folder / "verified.json", receipt)
        write_json(folder / "source-bundle.json", stored_bundle)
        with patch.object(pipeline, "current_bundle", return_value=stored_bundle), \
                patch.object(pipeline, "verify_ready", side_effect=ValueError("review evidence changed")):
            self.assertIsNone(pipeline.accepted_pilot(self.work))
        with patch.object(pipeline, "current_bundle", return_value=stored_bundle), \
                patch.object(pipeline, "verify_ready", return_value=True) as verify:
            result = pipeline.accepted_pilot(self.work)
        verify.assert_called_once_with(receipt, stored_bundle, folder)
        self.assertEqual(result["unitId"], "pilot")

        def reject_stale(receipt, fresh, folder):
            self.assertEqual(fresh, {"selector": "fresh-evidence-added"})
            raise ValueError("Verified chapter source identity changed")

        with patch.object(pipeline, "current_bundle", return_value={"selector": "fresh-evidence-added"}), \
                patch.object(pipeline, "verify_ready", side_effect=reject_stale):
            self.assertIsNone(pipeline.accepted_pilot(self.work))

    def test_bounded_workers_prepare_all_sources_before_dispatch_and_report_only_metadata(self):
        lock = threading.Lock()
        barrier = threading.Barrier(3)
        prepared, active, peak, calls, snapshots = [], 0, 0, [], []
        original_status = pipeline.write_run_status

        def loader(book, unit, *args):
            prepared.append(unit["id"])
            return self.bundle_loader(book, unit, *args)

        def worker(bundle, folder, timeout):
            nonlocal active, peak
            self.assertEqual(len(prepared), 9)
            with lock:
                active += 1
                peak = max(peak, active)
                calls.append(bundle["chapter"]["unitId"])
            barrier.wait(timeout=3)
            with lock:
                active -= 1
            return self.successful_worker(bundle, folder, timeout)

        def capture_status(*args):
            value = original_status(*args)
            snapshots.append(deepcopy(value))
            return value

        with patch.object(pipeline, "write_run_status", side_effect=capture_status):
            code = self.run_main(count=9, workers=3, loader=loader, worker=worker)
        self.assertEqual(code, 0)
        self.assertEqual(peak, 3)
        self.assertEqual(len(set(calls)), 9)
        self.assertTrue(all(snapshot["counts"]["running"] <= 3 for snapshot in snapshots))
        self.assertEqual(self.status()["counts"], {"queued": 0, "running": 0, "verified": 9,
            "failed": 0, "waiting-audio": 0, "provider-paused": 0})
        self.assertNotIn("PRIVATE SOURCE BODY", json.dumps(self.status()))

    def test_quota_stops_further_dispatch_and_allows_inflight_checkpoint_to_finish(self):
        second_started = threading.Event()
        second_finished = threading.Event()
        calls = []

        def worker(bundle, folder, timeout):
            unit_id = bundle["chapter"]["unitId"]
            calls.append(unit_id)
            if unit_id == "unit-000":
                self.assertTrue(second_started.wait(3))
                raise pipeline.QuotaReached("offline quota fixture")
            if unit_id == "unit-001":
                second_started.set()
                time.sleep(0.05)
                folder.mkdir(parents=True, exist_ok=True)
                (folder / "checkpoint.txt").write_text("Completed bounded in-flight work.", encoding="utf-8")
                second_finished.set()
                return self.successful_worker(bundle, folder, timeout)
            self.fail("A new chapter was dispatched after the provider paused")

        self.assertEqual(self.run_main(count=9, workers=2, worker=worker), 2)
        self.assertEqual(set(calls), {"unit-000", "unit-001"})
        self.assertTrue(second_finished.is_set())
        self.assertEqual(len(list(self.work.rglob("checkpoint.txt"))), 1)
        self.assertTrue((self.work / "provider-paused.json").exists())
        self.assertEqual(self.status()["phase"], "provider-paused")
        self.assertEqual(self.status()["counts"], {"queued": 0, "running": 0, "verified": 1,
            "failed": 0, "waiting-audio": 0, "provider-paused": 8})

    def test_waiting_audio_is_not_dispatched_and_supported_chapters_run_first(self):
        self.bundles["unit-000"]["declaredAudioTracks"] = [1]
        calls = []

        def worker(bundle, folder, timeout):
            calls.append(bundle["chapter"]["unitId"])
            return self.successful_worker(bundle, folder, timeout)

        self.assertEqual(self.run_main(count=3, workers=1, worker=worker), 0)
        self.assertEqual(calls, ["unit-001", "unit-002"])
        self.assertEqual(self.status()["counts"]["waiting-audio"], 1)
        self.assertEqual(self.status()["counts"]["verified"], 2)

    def test_waiting_audio_is_reconsidered_only_while_another_job_is_running(self):
        release_first = threading.Event()
        waiting_loads = 0
        calls = []
        self.bundles["unit-001"]["declaredAudioTracks"] = [1]

        def loader(book, unit, *args):
            nonlocal waiting_loads
            bundle = self.bundle_loader(book, unit, *args)
            if unit["id"] == "unit-001":
                waiting_loads += 1
                if waiting_loads > 1:
                    bundle["approvedMaterials"] = [{"id": "approved-track"}]
                    bundle["sourceSetSha256"] = contract.text_sha("now-approved")
                    release_first.set()
            return bundle

        def worker(bundle, folder, timeout):
            calls.append(bundle["chapter"]["unitId"])
            if bundle["chapter"]["unitId"] == "unit-000":
                self.assertTrue(release_first.wait(3))
            else:
                self.assertTrue(bundle["approvedMaterials"])
            return self.successful_worker(bundle, folder, timeout)

        with patch.object(pipeline, "AUDIO_REGISTRY_RECHECK_SECONDS", 0.01):
            self.assertEqual(self.run_main(count=2, workers=1, loader=loader, worker=worker), 0)
        self.assertEqual(waiting_loads, 2)
        self.assertEqual(calls, ["unit-000", "unit-001"])
        self.assertEqual(self.status()["counts"]["waiting-audio"], 0)
        self.assertEqual(self.status()["counts"]["verified"], 2)

    def test_only_waiting_audio_does_not_start_models_or_poll(self):
        self.bundles["unit-000"]["declaredAudioTracks"] = [1]
        with patch.object(pipeline, "wait", side_effect=AssertionError("An idle audio-only run polled")):
            self.assertEqual(self.run_main(count=1, workers=1, pilot=False,
                worker=lambda *args: self.fail("Missing audio started a chapter")), 0)
        self.assertEqual(self.status()["phase"], "waiting-audio")
        self.assertEqual(self.status()["counts"]["waiting-audio"], 1)

    def test_preparation_failure_is_counted_without_blocking_other_supported_units(self):
        def loader(book, unit, *args):
            if unit["id"] == "unit-000":
                raise ValueError("PRIVATE SOURCE BODY MUST NEVER APPEAR IN RUN STATUS")
            return self.bundle_loader(book, unit, *args)

        self.assertEqual(self.run_main(count=2, loader=loader), 1)
        self.assertEqual(self.status()["counts"]["failed"], 1)
        self.assertEqual(self.status()["counts"]["verified"], 1)
        self.assertEqual(self.status()["phase"], "incomplete")
        self.assertNotIn("PRIVATE SOURCE BODY", json.dumps(self.status()))


class AnalysisOnlyOrchestrationTests(unittest.TestCase):
    setUp = WorkerOrchestrationTests.setUp
    bundle_loader = WorkerOrchestrationTests.bundle_loader

    def successful_worker(self, bundle, folder, timeout):
        return {"unitId": bundle["chapter"]["unitId"], "status": "analysis-verified",
                "file": str(folder / "analysis-verified.json"), "teachingPoints": 7,
                "sourceImages": len(bundle["attachments"])}

    def run_main(self, count=1, workers=1, loader=None, worker=None, extra=()):
        argv = ["--analyze-only", "--work", str(self.work), "--workers", str(workers), *extra]
        with patch.object(pipeline, "load_inventory", return_value=self.inventory[:count]), \
                patch.object(pipeline, "load_bundle", side_effect=loader or self.bundle_loader), \
                patch.object(pipeline, "analyze_chapter", side_effect=worker or self.successful_worker), \
                patch.object(pipeline, "run_chapter", side_effect=AssertionError("Source-only run authored a lesson")), \
                patch.object(pipeline, "accepted_pilot", side_effect=AssertionError("Source-only run checked the full pilot gate")), \
                redirect_stdout(io.StringIO()):
            return pipeline.main(argv)

    def status(self):
        return pipeline.read(self.work / "source-analysis-status.json")

    def test_explicit_recovery_ignores_external_snapshot_only_for_authorized_run(self):
        write_json(pipeline.LEXICON_RUN_STATUS, {"providerLimited": True, "at": "old-limit"})
        original = pipeline.LEXICON_RUN_STATUS.read_bytes()

        def checked_worker(bundle, folder, timeout):
            with pipeline.PROVIDER_START_LOCK:
                pipeline.check_provider_pause(folder / "analysis-draft-1.json")
            return self.successful_worker(bundle, folder, timeout)

        self.assertEqual(self.run_main(worker=checked_worker, extra=("--resume-after-quota",)), 0)
        self.assertEqual(pipeline.LEXICON_RUN_STATUS.read_bytes(), original)
        self.assertEqual(self.run_main(worker=checked_worker), 2)
        self.assertEqual(pipeline.LEXICON_RUN_STATUS.read_bytes(), original)

    def test_external_limited_snapshot_change_recloses_circuit_during_authorized_run(self):
        write_json(pipeline.LEXICON_RUN_STATUS, {"providerLimited": True, "at": "old-limit"})
        original = pipeline.LEXICON_RUN_STATUS.read_bytes()
        completed = []

        def checked_worker(bundle, folder, timeout):
            with pipeline.PROVIDER_START_LOCK:
                pipeline.check_provider_pause(folder / "analysis-draft-1.json")
            completed.append(bundle["chapter"]["unitId"])
            # Even semantically identical newly written bytes are a new external
            # snapshot. Only the test modifies this temporary foreign status.
            pipeline.LEXICON_RUN_STATUS.write_bytes(original + b"\n")
            return self.successful_worker(bundle, folder, timeout)

        self.assertEqual(self.run_main(count=2, workers=1, worker=checked_worker,
                                       extra=("--resume-after-quota",)), 2)
        self.assertEqual(completed, ["unit-000"])
        self.assertEqual(self.status()["counts"]["verified"], 1)
        self.assertEqual(self.status()["counts"]["provider-paused"], 1)
        self.assertEqual(pipeline.LEXICON_RUN_STATUS.read_bytes(), original + b"\n")

    def test_analysis_action_is_exclusive_and_workers_are_bounded(self):
        invalid = [("--analyze-only", "--generate"), ("--analyze-only", "--dry-run"),
                   ("--analyze-only", "--workers", "0"), ("--analyze-only", "--workers", "9")]
        for arguments in invalid:
            with self.subTest(arguments=arguments), patch("sys.stderr", io.StringIO()), \
                    patch.object(pipeline, "load_inventory", side_effect=AssertionError("Invalid arguments loaded sources")), \
                    self.assertRaises(SystemExit) as raised:
                pipeline.main(arguments)
            self.assertEqual(raised.exception.code, 2)

    def test_eight_source_workers_skip_full_pilot_gate_and_preserve_full_status(self):
        full_status = self.work / "run-status.json"
        write_json(full_status, {"stage": "full-pilot", "counts": {"verified": 0}})
        original_full = full_status.read_bytes()
        barrier = threading.Barrier(8)
        lock = threading.Lock()
        prepared, calls, stop_events, snapshots = [], [], [], []
        active = peak = 0
        original_status = pipeline.write_run_status

        def loader(book, unit, *args):
            prepared.append(unit["id"])
            return self.bundle_loader(book, unit, *args)

        def worker(bundle, folder, timeout):
            nonlocal active, peak
            self.assertEqual(len(prepared), 8)
            self.assertEqual(folder, self.work / "units" / bundle["chapter"]["unitId"] / bundle["sourceSetSha256"])
            with lock:
                active += 1
                peak = max(peak, active)
                calls.append(bundle["chapter"]["unitId"])
                stop_events.append(pipeline.CALL_CONTEXT.provider_stop)
            barrier.wait(timeout=3)
            with lock:
                active -= 1
            return self.successful_worker(bundle, folder, timeout)

        def capture(*args):
            value = original_status(*args)
            snapshots.append(deepcopy(value))
            return value

        with patch.object(pipeline, "write_run_status", side_effect=capture):
            self.assertEqual(self.run_main(count=8, workers=8, loader=loader, worker=worker), 0)
        self.assertEqual(peak, 8)
        self.assertEqual(len(set(calls)), 8)
        self.assertEqual(len({id(event) for event in stop_events}), 1)
        self.assertTrue(all(snapshot["counts"]["running"] <= 8 for snapshot in snapshots))
        self.assertTrue(all(snapshot["stage"] == "source-analysis" for snapshot in snapshots))
        self.assertEqual(self.status()["counts"]["verified"], 8)
        self.assertEqual(self.status()["phase"], "complete")
        self.assertTrue(all(row["teachingPoints"] == 7 for row in self.status()["chapters"]))
        self.assertTrue(all(Path(row["file"]).name == "analysis-verified.json" for row in self.status()["chapters"]))
        self.assertNotIn("PRIVATE SOURCE BODY", json.dumps(self.status()))
        self.assertEqual(full_status.read_bytes(), original_full)
        self.assertEqual(list(self.work.rglob("verified.json")), [])

    def test_resumed_analysis_is_counted_only_in_source_status(self):
        def worker(bundle, folder, timeout):
            return {**self.successful_worker(bundle, folder, timeout), "status": "analysis-resumed"}

        self.assertEqual(self.run_main(worker=worker), 0)
        self.assertEqual(self.status()["counts"]["verified"], 1)
        self.assertFalse((self.work / "run-status.json").exists())

    def test_full_lesson_worker_result_cannot_satisfy_analysis_stage(self):
        def worker(bundle, folder, timeout):
            return {**self.successful_worker(bundle, folder, timeout), "status": "verified"}

        self.assertEqual(self.run_main(worker=worker), 1)
        self.assertEqual(self.status()["counts"]["verified"], 0)
        self.assertEqual(self.status()["counts"]["failed"], 1)

    def test_exact_exclusions_apply_before_limit_and_never_prepare_excluded_units(self):
        prepared = []

        def loader(book, unit, *args):
            prepared.append(unit["id"])
            return self.bundle_loader(book, unit, *args)

        self.assertEqual(self.run_main(count=9, loader=loader,
            extra=("--exclude-unit", "unit-000", "--exclude-unit", "unit-003", "--limit", "3")), 0)
        self.assertEqual(prepared, ["unit-001", "unit-002", "unit-004"])
        self.assertEqual(self.status()["selected"], 3)

    def test_unknown_include_and_exclude_ids_fail_before_loading_even_outside_selection(self):
        for arguments in (("--exclude-unit", "unit-00"),
                          ("--unit", "unit-000", "--exclude-unit", "unknown"),
                          ("--unit", "unknown", "--exclude-unit", "unknown")):
            with self.subTest(arguments=arguments), patch("sys.stderr", io.StringIO()), self.assertRaises(SystemExit):
                self.run_main(count=9, loader=lambda *args: self.fail("Unknown ID reached bundle preparation"), extra=arguments)
        self.assertEqual(self.run_main(count=9,
            extra=("--unit", "unit-000", "--exclude-unit", "unit-008")), 0)
        self.assertEqual(self.status()["selected"], 1)

    def test_quota_stops_dispatch_and_shares_the_inflight_stop_event(self):
        second_started = threading.Event()
        calls, stop_events = [], []

        def worker(bundle, folder, timeout):
            unit_id = bundle["chapter"]["unitId"]
            calls.append(unit_id)
            stop = pipeline.CALL_CONTEXT.provider_stop
            stop_events.append(stop)
            if unit_id == "unit-000":
                self.assertTrue(second_started.wait(3))
                raise pipeline.QuotaReached("Offline source-analysis quota fixture")
            if unit_id == "unit-001":
                second_started.set()
                self.assertTrue(stop.wait(3))
                write_json(folder / "analysis-draft-1.json", {"checkpoint": "completed in-flight analysis"})
                return self.successful_worker(bundle, folder, timeout)
            self.fail("Source analysis was dispatched after quota pause")

        self.assertEqual(self.run_main(count=9, workers=2, worker=worker), 2)
        self.assertEqual(set(calls), {"unit-000", "unit-001"})
        self.assertIs(stop_events[0], stop_events[1])
        self.assertTrue((self.work / "provider-paused.json").exists())
        self.assertEqual(len(list(self.work.rglob("analysis-draft-1.json"))), 1)
        self.assertEqual(self.status()["counts"]["provider-paused"], 8)
        self.assertEqual(self.status()["counts"]["verified"], 1)
        self.assertFalse((self.work / "run-status.json").exists())

    def test_analysis_honors_shared_provider_circuit_and_explicit_resume(self):
        circuit = self.work / "provider-paused.json"
        write_json(circuit, {"reason": "existing full-generation provider pause"})
        with self.assertRaisesRegex(ValueError, "Provider was paused"):
            self.run_main(loader=lambda *args: self.fail("Paused run loaded sources"))
        self.assertEqual(self.run_main(extra=("--resume-after-quota",)), 0)
        self.assertFalse(circuit.exists())

    def test_only_unready_audio_waits_without_dispatch_or_idle_poll(self):
        self.bundles["unit-000"]["declaredAudioTracks"] = [1]
        with patch.object(pipeline, "wait", side_effect=AssertionError("Idle source analysis polled audio")):
            self.assertEqual(self.run_main(worker=lambda *args: self.fail("Unready audio was analyzed")), 0)
        self.assertEqual(self.status()["phase"], "waiting-audio")
        self.assertEqual(self.status()["counts"]["waiting-audio"], 1)
        self.assertEqual(self.status()["counts"]["verified"], 0)

    def test_audio_becomes_ready_during_another_analysis_and_uses_new_bundle(self):
        released = threading.Event()
        loads, calls = [], []
        self.bundles["unit-001"]["declaredAudioTracks"] = [1]

        def loader(book, unit, *args):
            bundle = self.bundle_loader(book, unit, *args)
            if unit["id"] == "unit-001":
                loads.append(unit["id"])
                if len(loads) > 1:
                    bundle["approvedMaterials"] = [{"id": "approved-track"}]
                    bundle["sourceSetSha256"] = contract.text_sha("audio-now-approved")
                    released.set()
            return bundle

        def worker(bundle, folder, timeout):
            calls.append(bundle["chapter"]["unitId"])
            if bundle["chapter"]["unitId"] == "unit-000":
                self.assertTrue(released.wait(3))
            else:
                self.assertTrue(bundle["approvedMaterials"])
                self.assertEqual(folder.name, contract.text_sha("audio-now-approved"))
            return self.successful_worker(bundle, folder, timeout)

        with patch.object(pipeline, "AUDIO_REGISTRY_RECHECK_SECONDS", 0.01):
            self.assertEqual(self.run_main(count=2, workers=1, loader=loader, worker=worker), 0)
        self.assertEqual(len(loads), 2)
        self.assertEqual(calls, ["unit-000", "unit-001"])
        self.assertEqual(self.status()["counts"]["verified"], 2)


if __name__ == "__main__":
    unittest.main()

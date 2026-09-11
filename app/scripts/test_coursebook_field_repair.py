"""Offline, exact-input field-repair regressions; no CLI or model calls."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import coursebook_field_repair as repair
from coursebook_editorial_patch import load_patch
from coursebook_lesson_template import value_sha, text_sha
from test_coursebook_lesson_template import fixture


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class FieldRepairTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.folder = Path(temp.name)
        self.base, lesson_request = fixture()
        payload = lesson_request["payload"]
        attachments = []
        for page in payload["chapter"]["pages"]:
            image = self.folder / f"page-{page}.jpg"
            image.write_bytes(b"\xff\xd8" + str(page).encode() + b"\xff\xd9")
            attachments.append({"id": f"page-{page}", "bookId": payload["chapter"]["bookId"],
                "page": page, "role": "chapter", "path": str(image), "sha256": sha(image)})
        self.base["provenance"]["sourceImages"] = [
            {"page": a["page"], "sha256": a["sha256"]} for a in attachments]
        self.bundle = {"version": 1, "chapter": deepcopy(payload["chapter"]),
            "source": deepcopy(payload["source"]), "headingCandidates": [],
            "attachments": attachments, "approvedMaterials": [], "declaredAudioTracks": [],
            "sourceFiles": []}
        self.bundle["sourceSetSha256"] = value_sha(self.bundle)
        self.points = deepcopy(payload["requiredPoints"])
        self.base_path = self.folder / "lesson-draft-1-repair-2.json"
        write_json(self.base_path, self.base)
        self.findings = [{"path": ["examples", 0, "why"],
                          "issue": "Explain the recipient's specific concern and the contrast in meaning."}]
        self.request = self.build()
        self.proposal_path = self.folder / "lesson-field-repair-1.json"
        self.proposal = {key: deepcopy(self.request["payload"][key])
                         for key in repair.RESPONSE_SCHEMA["properties"] if key != "changes"}
        self.proposal["changes"] = [{"path": self.findings[0]["path"],
            "before": self.base["examples"][0]["why"],
            "after": "Адресату сначала нужно понять причину переноса, поэтому автор ставит объяснение перед рекомендацией. "
                     "Обратный порядок возможен в коротком напоминании после уже обсуждённой причины.",
            "reason": "Explain how the information order serves this recipient's immediate question."}]
        self.save_model()

    def build(self):
        return repair.build_request(self.bundle, self.folder, self.base_path.name,
                                    self.points, self.findings)

    def save_model(self):
        write_json(self.proposal_path, self.proposal)
        committed = {"version": "new-coursebooks-reviewed-chapters-v1", **self.request,
            "transportSchema": self.request["schema"], "attachments": self.bundle["attachments"]}
        request_path = self.proposal_path.with_suffix(".request.json")
        write_json(request_path, {**committed, "sha256": value_sha(committed)})
        self.invocation = {"version": 1, "role": repair.MODEL_ROLE, "model": repair.MODEL,
            "requestSha256": sha(request_path), "promptSha256": text_sha(self.request["prompt"]),
            "payloadSha256": value_sha(self.request["payload"]),
            "schemaSha256": value_sha(self.request["schema"]),
            "transportSchemaSha256": value_sha(self.request["schema"]),
            "attachments": self.bundle["attachments"],
            "httpArguments": ["model_providers.openai-http.supports_websockets=false",
                              "model_providers.openai-http.requires_openai_auth=true"]}
        write_json(self.proposal_path.with_suffix(".invocation.json"), self.invocation)

    def prepare(self):
        return repair.prepare_patch(self.bundle, self.folder, self.request, self.proposal_path)

    def test_full_inputs_and_typed_model_marker_are_bound_without_mutation(self):
        before = deepcopy((self.bundle, self.base, self.points, self.findings))
        request = self.build()
        payload = request["payload"]
        self.assertEqual(payload["sourceBundle"], self.bundle)
        self.assertEqual(payload["candidate"], self.base)
        self.assertEqual(payload["requiredPoints"], self.points)
        self.assertEqual(payload["baseSha256"], sha(self.base_path))
        self.assertEqual(payload["baseCandidateSha256"], value_sha(self.base))
        self.assertEqual(payload["inputSha256"], value_sha({k: v for k, v in payload.items() if k != "inputSha256"}))
        self.assertEqual(request["schema"]["properties"]["kind"],
                         {"type": "string", "enum": ["coursebook-field-repair-v1"]})
        self.assertEqual((self.bundle, self.base, self.points, self.findings), before)

    def test_prepare_is_read_only_and_exactly_load_patch_compatible(self):
        snapshot = {p.name: p.read_bytes() for p in self.folder.iterdir()}
        prepared = self.prepare()
        self.assertEqual(snapshot, {p.name: p.read_bytes() for p in self.folder.iterdir()})
        expected = deepcopy(self.base)
        expected["examples"][0]["why"] = self.proposal["changes"][0]["after"]
        self.assertEqual(prepared["candidate"], expected)
        evidence = prepared["evidence"]
        self.assertEqual(evidence["candidateSha256"], value_sha(expected))
        self.assertEqual(evidence["editorialPatchSha256"], value_sha(prepared["patch"]))
        self.assertEqual(evidence["modelProposal"]["sha256"], sha(self.proposal_path))
        self.assertEqual(evidence["modelProposal"]["model"], "gpt-5.6-sol")
        self.assertTrue(evidence["requiresIndependentReview"])
        self.assertNotIn("decision", evidence)
        self.assertEqual(repair.verify_prepared_patch(self.bundle, self.folder, self.request,
            self.proposal_path, prepared["patch"], evidence), expected)
        write_json(self.folder / "editorial-patch.json", prepared["patch"])
        loaded, legacy_evidence = load_patch(self.bundle, self.folder)
        self.assertEqual(loaded, expected)
        self.assertEqual(legacy_evidence["candidateSha256"], evidence["candidateSha256"])

    def test_missing_or_invalid_coverage_and_array_additions_are_refused_before_request(self):
        for case in ("missing-point", "changed-label", "missing-exercise", "short-array", "unmapped-section"):
            with self.subTest(case=case):
                base = deepcopy(self.base)
                if case == "missing-point":
                    base["provenance"]["sourceCoverage"].pop()
                elif case == "changed-label":
                    base["provenance"]["sourceCoverage"][0]["point"] = "Short rewritten label"
                elif case == "missing-exercise":
                    base["provenance"]["sourceCoverage"][0]["exerciseIds"] = ["absent"]
                elif case == "short-array":
                    base["exercises"] = base["exercises"][:2]
                else:
                    base["sections"].append({"title": "Новый раздел", "body": "Missing mapping"})
                write_json(self.base_path, base)
                with self.assertRaises(ValueError):
                    self.build()
        write_json(self.base_path, self.base)

    def test_current_source_attachment_metadata_and_base_bytes_cannot_drift(self):
        original_bundle = deepcopy(self.bundle)
        for case in ("source", "rehashed-source", "attachment-metadata", "base-bytes", "base-content"):
            with self.subTest(case=case):
                self.bundle = deepcopy(original_bundle)
                write_json(self.base_path, self.base)
                if case in ("source", "rehashed-source"):
                    self.bundle["source"]["text"] += " changed"
                    if case == "rehashed-source":
                        self.bundle.pop("sourceSetSha256")
                        self.bundle["sourceSetSha256"] = value_sha(self.bundle)
                elif case == "attachment-metadata":
                    self.bundle["attachments"][0]["role"] = "supplement"
                elif case == "base-bytes":
                    self.base_path.write_bytes(self.base_path.read_bytes() + b"\n")
                else:
                    changed = deepcopy(self.base)
                    changed["goal"] += " changed"
                    write_json(self.base_path, changed)
                with self.assertRaises(ValueError):
                    self.prepare()

    def test_actual_attachment_bytes_are_checked_before_returning_patch(self):
        image = Path(self.bundle["attachments"][0]["path"])
        image.write_bytes(image.read_bytes() + b"changed")
        with self.assertRaisesRegex(ValueError, "image bytes changed"):
            self.prepare()

    def test_every_model_echo_is_exact_including_version_type(self):
        original = deepcopy(self.proposal)
        for key in set(original) - {"changes"}:
            with self.subTest(key=key):
                self.proposal = deepcopy(original)
                self.proposal[key] = True if key == "version" else self.proposal[key] + "changed"
                write_json(self.proposal_path, self.proposal)
                with self.assertRaisesRegex(ValueError, "echo changed"):
                    self.prepare()

    def test_request_and_invocation_metadata_cannot_be_forged_or_omitted(self):
        for case in ("request-payload", "request-attachments", "missing-request", "missing-invocation",
                     "model", "role", "payloadSha256", "httpArguments"):
            with self.subTest(case=case):
                self.save_model()
                if case.startswith("request-"):
                    path = self.proposal_path.with_suffix(".request.json")
                    request = json.loads(path.read_text(encoding="utf-8"))
                    if case == "request-payload":
                        request["payload"]["findings"][0]["issue"] = "Invent a different problem."
                    else:
                        request["attachments"] = []
                    request["sha256"] = value_sha({k: v for k, v in request.items() if k != "sha256"})
                    write_json(path, request)
                elif case.startswith("missing-"):
                    suffix = ".request.json" if case == "missing-request" else ".invocation.json"
                    self.proposal_path.with_suffix(suffix).unlink()
                else:
                    invocation = deepcopy(self.invocation)
                    invocation[case] = [] if case == "httpArguments" else "different"
                    write_json(self.proposal_path.with_suffix(".invocation.json"), invocation)
                with self.assertRaises(ValueError):
                    self.prepare()

    def test_identifier_material_coverage_and_nonexistent_findings_are_not_patchable(self):
        for path in (["id"], ["materials", 0, "text"], ["sections", 0, "title"],
                     ["provenance", "sourceCoverage", 0, "point"], ["exercises", 0, "answers"],
                     ["examples", True, "why"], ["examples", -1, "why"],
                     ["examples", "0", "why"], ["examples", 0.0, "why"],
                     ["examples", 300, "why"]):
            with self.subTest(path=path):
                findings = [{"path": path, "issue": "A precise issue requiring a text change."}]
                with self.assertRaises(ValueError):
                    repair.build_request(self.bundle, self.folder, self.base_path.name, self.points, findings)

    def test_changes_require_before_exact_reason_scope_and_unique_paths(self):
        original = deepcopy(self.proposal)
        for case in ("before", "empty", "same", "reason", "extra", "duplicate", "other-path", "unknown-field", "boolean-index"):
            with self.subTest(case=case):
                self.proposal = deepcopy(original)
                change = self.proposal["changes"][0]
                if case == "before": change["before"] += " changed"
                elif case == "empty": change["after"] = " \n "
                elif case == "same": change["after"] = change["before"]
                elif case == "reason": change["reason"] = "short"
                elif case == "extra": self.proposal["accepted"] = True
                elif case == "duplicate": self.proposal["changes"].append(deepcopy(change))
                elif case == "other-path":
                    change["path"] = ["examples", 1, "why"]
                elif case == "unknown-field": change["operation"] = "replace"
                else: change["path"] = ["examples", True, "why"]
                write_json(self.proposal_path, self.proposal)
                with self.assertRaises(ValueError):
                    self.prepare()

    def test_prompt_range_lowering_removal_or_widening_is_rejected_but_text_clarification_is_allowed(self):
        self.findings = [{"path": ["exercises", 1, "prompt"], "issue": "Clarify the actual recipient without changing the output range."}]
        self.request = self.build()
        self.proposal = {key: deepcopy(self.request["payload"][key]) for key in repair.RESPONSE_SCHEMA["properties"] if key != "changes"}
        before = self.base["exercises"][1]["prompt"]
        for replacement in ("5–30 слов", "10–100 слов", "", "1001–1002 слов"):
            with self.subTest(replacement=replacement):
                self.proposal["changes"] = [{"path": self.findings[0]["path"], "before": before,
                    "after": before.replace("10–30 слов", replacement), "reason": "Clarify the recipient's question and preserve its substance."}]
                self.save_model()
                with self.assertRaisesRegex(ValueError, "word-range"):
                    self.prepare()
        self.proposal["changes"][0]["after"] = before + " Адресат уже знает сроки проекта."
        self.save_model()
        self.assertEqual(self.prepare()["candidate"]["exercises"][1]["prompt"], self.proposal["changes"][0]["after"])

    def test_new_missing_range_is_bounded_and_existing_string_answer_can_be_repaired(self):
        self.findings = [{"path": ["exercises", 0, "prompt"], "issue": "Specify the missing bounded output length for this complete response."},
                         {"path": ["exercises", 0, "answers", 0], "issue": "Make the recipient's requested next action explicit in the reference."}]
        self.request = self.build()
        self.proposal = {key: deepcopy(self.request["payload"][key]) for key in repair.RESPONSE_SCHEMA["properties"] if key != "changes"}
        self.proposal["changes"] = [
            {"path": ["exercises", 0, "prompt"], "before": self.base["exercises"][0]["prompt"],
             "after": self.base["exercises"][0]["prompt"] + " Объём ответа: 15–30 слов.", "reason": "Define the response scope without removing its existing requirements."},
            {"path": ["exercises", 0, "answers", 0], "before": self.base["exercises"][0]["answers"][0],
             "after": "Please explain the customer's main concern first and then support our recommendation with a concrete example from the tests.",
             "reason": "Make the next requested action natural and specific to the actual recipient."}]
        self.save_model()
        result = self.prepare()
        self.assertEqual(result["candidate"]["exercises"][0]["answers"][0], self.proposal["changes"][1]["after"])
        self.proposal["changes"][0]["after"] = self.proposal["changes"][0]["after"].replace("15–30", "1–4")
        self.save_model()
        with self.assertRaisesRegex(ValueError, "new output ranges"):
            self.prepare()

    def test_recorded_patch_and_model_proposal_byte_tampering_reject_existing_evidence(self):
        result = self.prepare()
        for case in ("patch", "candidate-hash", "model-file-bytes"):
            with self.subTest(case=case):
                patch, evidence = deepcopy(result["patch"]), deepcopy(result["evidence"])
                if case == "patch": patch["changes"][0]["after"] += " Extra sentence."
                elif case == "candidate-hash": evidence["candidateSha256"] = "0" * 64
                else: self.proposal_path.write_bytes(self.proposal_path.read_bytes() + b"\n")
                with self.assertRaisesRegex(ValueError, "evidence changed"):
                    repair.verify_prepared_patch(self.bundle, self.folder, self.request,
                        self.proposal_path, patch, evidence)

    def test_noncanonical_draft_and_traversal_cannot_be_requests_or_proposals(self):
        for name in ("../lesson-draft-1-repair-2.json", "lesson.json", str(self.base_path.resolve())):
            with self.subTest(name=name), self.assertRaises(ValueError):
                repair.build_request(self.bundle, self.folder, name, self.points, self.findings)
        for name in ("editorial-patch.json", "verified.json", "lesson-field-repair-0.json"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                repair.prepare_patch(self.bundle, self.folder, self.request, self.folder / name)
        changed = deepcopy(self.base)
        changed["id"] = self.bundle["chapter"]["unitId"]
        write_json(self.base_path, changed)
        with self.assertRaisesRegex(ValueError, "canonical"):
            self.build()


if __name__ == "__main__":
    unittest.main()

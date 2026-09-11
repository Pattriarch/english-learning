"""Offline proof, rejection and immutable full-review recovery regressions."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import coursebook_post_review as editorial
import coursebook_lesson_template as template
import generate_new_coursebooks as pipeline
from test_generate_new_coursebooks import bundle_fixture, isolate_provider_files, write_json


class PostReviewTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.folder = self.root / "chapter"
        isolate_provider_files(self, self.root)
        self.bundle, self.analysis, self.lesson = bundle_fixture(self.root)
        self.calls = []
        self.accept_editorial = True
        self.enterContext(patch.object(pipeline, "call_model", side_effect=self.fake_model))
        pipeline.run_analysis(self.bundle, self.folder, 10)
        self.author = pipeline.author_request(self.bundle, self.analysis, self.folder)
        self.lesson["provenance"].update(deepcopy(self.author["payload"]["requiredProvenance"]))
        pipeline.cached_call(self.folder / "lesson-draft-1.json", **{key: self.author[key] for key in ("prompt", "payload", "schema")}, attachments=self.bundle["attachments"], timeout=10)
        request = pipeline.lesson_review_request(self.lesson, self.author, self.bundle, self.folder)
        self.base_review = self.folder / "lesson-review-1.json"
        pipeline.cached_call(self.base_review, **{key: request[key] for key in ("prompt", "payload", "schema")}, attachments=self.bundle["attachments"], timeout=10)
        self.proposal_name = "lesson-editorial-proposal-1.json"
        self.proposal = self.make_proposal(self.base_review, self.lesson)
        write_json(self.folder / self.proposal_name, self.proposal)
        self.before = {p.name: p.read_bytes() for p in self.folder.iterdir()}

    def fake_model(self, prompt, payload, schema, attachments, path, timeout):
        self.calls.append({"path": path.name, "payload": deepcopy(payload), "attachments": deepcopy(attachments)})
        keys = schema["properties"]
        if "requiredPoints" in keys:
            result = deepcopy(self.analysis)
        elif "sections" in keys:
            result = deepcopy(self.lesson)
        else:
            source = "inputSha256" in keys
            accepted = source or ("postReviewEditorial" in payload and self.accept_editorial)
            result = {"unitId": payload["unitId"], "candidateSha256": payload["candidateSha256"],
                      "decision": "accept" if accepted else "revise", "findings": []}
            result["inputSha256" if source else "requestSha256"] = payload["inputSha256" if source else "requestSha256"]
            if not accepted:
                result["findings"] = [{"pointId": self.analysis["requiredPoints"][0]["id"], "exerciseId": self.lesson["exercises"][0]["id"],
                                      "issue": "Clarify the recipient's intended contrast without altering the original learning outcome."}]
        write_json(path, result)
        return result

    def make_proposal(self, review_path, base):
        return {"version": 1, "kind": editorial.KIND, "unitId": self.bundle["chapter"]["unitId"],
                "sourceSetSha256": self.bundle["sourceSetSha256"], "sourceReview": pipeline.checkpoint_record(review_path),
                "baseCandidateSha256": template.value_sha(base), "changes": [{"path": ["exercises", 0, "hint"],
                "before": base["exercises"][0]["hint"], "after": base["exercises"][0]["hint"] + " Учитывайте конкретную цель адресата.",
                "reason": "Clarify the practical recipient-facing choice without changing required output or source coverage."}]}

    def prepare(self):
        return editorial.prepare(self.bundle, self.folder, self.author, self.proposal_name)

    def test_exact_candidate_full_review_acceptance_and_immutable_prior_receipts(self):
        prepared = self.prepare()
        self.assertFalse((self.folder / "verified.json").exists())
        result = editorial.run(self.bundle, self.folder, self.proposal_name, 10)
        self.assertEqual(result["status"], "verified")
        receipt = pipeline.read(self.folder / "verified.json")
        self.assertEqual(receipt["lesson"], prepared["candidate"])
        self.assertTrue(pipeline.verify_ready(receipt, self.bundle, self.folder))
        self.assertEqual(self.calls[-1]["payload"]["candidate"], receipt["lesson"])
        self.assertEqual(self.calls[-1]["payload"]["applicationAndUserContract"], editorial.RENDERER_CONTRACT)
        self.assertEqual(self.calls[-1]["attachments"], self.bundle["attachments"])
        for name, raw in self.before.items():
            self.assertEqual((self.folder / name).read_bytes(), raw, name)
        with self.assertRaisesRegex(ValueError, "existing accepted"):
            editorial.run(self.bundle, self.folder, self.proposal_name, 10)

    def test_independent_rejection_does_not_publish_then_exact_second_proposal_can_pass(self):
        self.accept_editorial = False
        first = editorial.run(self.bundle, self.folder, self.proposal_name, 10)
        self.assertEqual(first["status"], "editorial-revise")
        self.assertFalse((self.folder / "verified.json").exists())
        prepared = self.prepare()
        old = self.folder / "lesson-editorial-review-1.json"
        self.proposal_name = "lesson-editorial-proposal-2.json"
        proposal = self.make_proposal(old, prepared["candidate"])
        write_json(self.folder / self.proposal_name, proposal)
        old_bytes = old.read_bytes()
        self.accept_editorial = True
        self.assertEqual(editorial.run(self.bundle, self.folder, self.proposal_name, 10)["status"], "verified")
        self.assertEqual(old.read_bytes(), old_bytes)
        self.assertTrue(pipeline.verify_ready(pipeline.read(self.folder / "verified.json"), self.bundle, self.folder))

    def test_recovery_proposal_never_grants_acceptance_without_fresh_review(self):
        prepared = self.prepare()
        with patch.object(pipeline, "cached_call", side_effect=RuntimeError("Transport unavailable")):
            with self.assertRaisesRegex(RuntimeError, "Transport unavailable"):
                editorial.run(self.bundle, self.folder, self.proposal_name, 10)
        self.assertFalse((self.folder / "verified.json").exists())
        self.assertEqual(prepared, self.prepare())

    def test_wrong_before_hash_source_identity_and_forbidden_fields_fail_before_review(self):
        for case in ("before", "hash", "source", "id", "kind", "coverage"):
            with self.subTest(case=case):
                proposal = deepcopy(self.proposal)
                if case == "before": proposal["changes"][0]["before"] += " changed"
                if case == "hash": proposal["baseCandidateSha256"] = "0" * 64
                if case == "source": proposal["sourceSetSha256"] = "0" * 64
                if case == "id": proposal["unitId"] = "different-unit"
                if case == "kind": proposal["changes"][0]["path"] = ["exercises", 0, "kind"]
                if case == "coverage": proposal["changes"][0]["path"] = ["provenance", "sourceCoverage"]
                write_json(self.folder / self.proposal_name, proposal)
                with self.assertRaises(ValueError): self.prepare()
        write_json(self.folder / self.proposal_name, self.proposal)

    def test_old_request_response_and_source_image_tampering_invalidates_proof(self):
        for path in (self.base_review, self.base_review.with_suffix(".request.json"), Path(self.bundle["attachments"][0]["path"])):
            with self.subTest(path=path.name):
                raw = path.read_bytes(); path.write_bytes(raw + b" ")
                with self.assertRaises(ValueError): self.prepare()
                path.write_bytes(raw)

    def test_structural_depth_regression_never_reaches_new_review(self):
        self.proposal["changes"] = [{"path": ["sections", 0, "body"], "before": self.lesson["sections"][0]["body"],
                                    "after": "Too brief.", "reason": "An invalid attempted shortening must not bypass complete lesson depth."}]
        write_json(self.folder / self.proposal_name, self.proposal)
        count = len(self.calls)
        with self.assertRaises(ValueError): self.prepare()
        self.assertEqual(len(self.calls), count)

    def test_cyclic_forward_chain_and_path_traversal_are_rejected(self):
        for name in ("../lesson-editorial-proposal-1.json", "lesson-editorial-proposal-7.json"):
            with self.assertRaises(ValueError): editorial.prepare(self.bundle, self.folder, self.author, name)
        self.proposal["sourceReview"]["file"] = "lesson-editorial-review-1.json"
        write_json(self.folder / self.proposal_name, self.proposal)
        with self.assertRaises((ValueError, FileNotFoundError)): self.prepare()

    def test_receipt_and_late_proposal_changes_cannot_substitute_reviewed_candidate(self):
        editorial.run(self.bundle, self.folder, self.proposal_name, 10)
        receipt = pipeline.read(self.folder / "verified.json")
        for field in ("evidence", "candidate", "review"):
            changed = deepcopy(receipt)
            if field == "evidence": changed["postReviewEditorial"]["sha256"] = "0" * 64
            if field == "candidate": changed["lesson"]["exercises"][0]["hint"] += " substituted"
            if field == "review": changed["lessonAcceptance"]["file"] = "lesson-review-1.json"
            with self.assertRaises(ValueError): pipeline.verify_ready(changed, self.bundle, self.folder)
        path = self.folder / self.proposal_name
        path.write_bytes(path.read_bytes() + b" ")
        with self.assertRaises(ValueError): pipeline.verify_ready(receipt, self.bundle, self.folder)

    def test_exact_workflow_move_requires_new_version_and_full_review_receipt(self):
        stages = self.lesson["studyPlan"]["stages"]
        self.proposal.update({"version": 2, "kind": editorial.KIND_WITH_MOVE,
            "workflowMove": {"exerciseId": "e3", "fromStage": "input", "toStage": "practice",
                "beforeFrom": deepcopy(stages[1]["exerciseIds"]), "beforeTo": deepcopy(stages[2]["exerciseIds"]),
                "afterId": "e14", "reason": "Place the final input check after the complete prerequisite practice without changing any task."}})
        write_json(self.folder / self.proposal_name, self.proposal)
        prepared = self.prepare()
        self.assertEqual(prepared["candidate"]["studyPlan"]["stages"][1]["exerciseIds"], ["e2"])
        self.assertEqual(prepared["candidate"]["studyPlan"]["stages"][2]["exerciseIds"][-1], "e3")
        self.assertEqual(prepared["candidate"]["exercises"], [
            {**exercise, "hint": prepared["candidate"]["exercises"][0]["hint"]} if index == 0 else exercise
            for index, exercise in enumerate(self.lesson["exercises"])])
        editorial.run(self.bundle, self.folder, self.proposal_name, 10)
        receipt = pipeline.read(self.folder / "verified.json")
        self.assertTrue(pipeline.verify_ready(receipt, self.bundle, self.folder))
        changed = deepcopy(receipt); changed["postReviewEditorial"]["workflowMove"]["afterId"] = "e13"
        with self.assertRaises(ValueError): pipeline.verify_ready(changed, self.bundle, self.folder)

    def test_legacy_proposal_cannot_silently_add_a_workflow_move(self):
        self.proposal["workflowMove"] = {}
        write_json(self.folder / self.proposal_name, self.proposal)
        with self.assertRaisesRegex(ValueError, "identity/source"):
            self.prepare()

    def add_original_material_proposal(self):
        exercise = self.lesson["exercises"][1]
        self.proposal.update({"version": 3, "kind": editorial.KIND_WITH_MATERIALS,
            "originalMaterialAdditions": {"beforeMaterialIds": [m["id"] for m in self.lesson["materials"]],
                "items": [{"material": {"id": "original-new-listening", "title": "A new spoken contrast",
                    "kind": "listening", "text": "There is one notebook on my desk. Two folders are beside the lamp.",
                    "source": "Original course adaptation", "inputSkill": "listening-script"},
                    "exerciseLinks": [{"exerciseId": exercise["id"], "beforeMaterialIds": deepcopy(exercise.get("materialIds", []))}],
                    "reason": "Supply new original listening choices for the existing number interpretation task."}]}})
        write_json(self.folder / self.proposal_name, self.proposal)

    def test_material_additions_still_require_exact_fresh_review_and_immutable_old_sources(self):
        self.add_original_material_proposal()
        prepared = self.prepare()
        self.assertEqual(prepared["candidate"]["materials"][:-1], self.lesson["materials"])
        self.assertEqual(prepared["candidate"]["studyPlan"], self.lesson["studyPlan"])
        self.assertEqual(prepared["candidate"]["provenance"], self.lesson["provenance"])
        self.assertFalse((self.folder / "verified.json").exists())
        editorial.run(self.bundle, self.folder, self.proposal_name, 10)
        receipt = pipeline.read(self.folder / "verified.json")
        self.assertEqual(self.calls[-1]["payload"]["candidate"], prepared["candidate"])
        self.assertTrue(pipeline.verify_ready(receipt, self.bundle, self.folder))
        changed = deepcopy(receipt)
        changed["postReviewEditorial"]["originalMaterialAdditions"]["items"][0]["material"]["text"] += " Changed."
        with self.assertRaises(ValueError): pipeline.verify_ready(changed, self.bundle, self.folder)

    def test_v1_followup_reconstructs_rejected_v3_additions_without_new_material_rewrite(self):
        self.add_original_material_proposal()
        self.accept_editorial = False
        editorial.run(self.bundle, self.folder, self.proposal_name, 10)
        prior = self.prepare()["candidate"]
        self.proposal_name = "lesson-editorial-proposal-2.json"
        write_json(self.folder / self.proposal_name, self.make_proposal(self.folder / "lesson-editorial-review-1.json", prior))
        prepared = self.prepare()
        self.assertEqual(prepared["candidate"]["materials"], prior["materials"])
        self.accept_editorial = True
        editorial.run(self.bundle, self.folder, self.proposal_name, 10)
        self.assertTrue(pipeline.verify_ready(pipeline.read(self.folder / "verified.json"), self.bundle, self.folder))

    def test_legacy_or_workflow_proposals_cannot_hide_material_additions(self):
        self.add_original_material_proposal()
        self.proposal.update({"version": 1, "kind": editorial.KIND})
        write_json(self.folder / self.proposal_name, self.proposal)
        with self.assertRaisesRegex(ValueError, "identity/source"): self.prepare()

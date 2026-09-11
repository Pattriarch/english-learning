"""Offline regressions for immutable, candidate-specific automatic repair proofs."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import coursebook_auto_repair as automatic
import coursebook_field_repair as editor
import coursebook_lesson_template as template
import generate_new_coursebooks as pipeline
from test_coursebook_field_repair import sha, write_json
from test_coursebook_lesson_template import fixture


class AutomaticFieldRepairTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name)
        self.base, original = fixture()
        payload = original["payload"]
        self.fixed_why = self.base["examples"][0]["why"]
        self.base["examples"][0]["why"] = "Слишком кратко."
        attachments = []
        for page in payload["chapter"]["pages"]:
            path = self.folder / f"page-{page}.jpg"
            path.write_bytes(b"\xff\xd8" + str(page).encode() + b"\xff\xd9")
            attachments.append({"id": f"page-{page}", "bookId": payload["chapter"]["bookId"],
                "page": page, "role": "chapter", "path": str(path), "sha256": sha(path)})
        images = [{"page": item["page"], "sha256": item["sha256"]} for item in attachments]
        self.base["provenance"]["sourceImages"] = deepcopy(images)
        self.bundle = {"version": 1, "chapter": deepcopy(payload["chapter"]),
            "source": deepcopy(payload["source"]), "headingCandidates": [],
            "attachments": attachments, "approvedMaterials": [], "declaredAudioTracks": [],
            "sourceFiles": []}
        self.bundle["sourceSetSha256"] = template.value_sha(self.bundle)
        self.points = deepcopy(payload["requiredPoints"])
        self.author_contract = template.build_request(self.bundle["chapter"], self.bundle["source"],
            self.points, images, [])
        self.base_file = "lesson-draft-1.json"
        self.save_base(self.base_file)
        self.requests = []
        self.process = self.enterContext(patch.object(pipeline.subprocess, "Popen", side_effect=self.fake_process))
        self.enterContext(patch.object(pipeline, "codex_command", return_value=["offline-test-codex"]))
        # Never consult or mutate the shared controller's real quota markers.
        self.enterContext(patch.object(pipeline, "check_provider_pause", return_value=None))

    def save_base(self, name, candidate=None):
        write_json(self.folder / name, self.base if candidate is None else candidate)

    def fake_process(self, command, **kwargs):
        """Replace process launch only; keep real request, invocation and raw output code."""
        text = kwargs["stdin"].read()
        prompt, serialized = text.split("\nINPUT DATA:\n", 1)
        payload = json.loads(serialized)
        self.assertEqual(prompt, editor.PROMPT)
        self.assertEqual(payload["sourceBundle"], self.bundle)
        self.assertEqual(payload["requiredPoints"], self.points)
        self.assertEqual([command[i + 1] for i, part in enumerate(command) if part == "--image"],
            [item["path"] for item in self.bundle["attachments"]])
        self.assertEqual(command[command.index("--sandbox") + 1], "read-only")
        self.assertEqual(command[command.index("--model") + 1], "gpt-5.6-sol")
        self.assertFalse(kwargs.get("shell", False))
        self.assertEqual(payload["findings"][0]["path"], ["examples", 0, "why"])
        proposal = {key: deepcopy(payload[key]) for key in editor.RESPONSE_SCHEMA["properties"]
                    if key != "changes"}
        proposal["changes"] = [{"path": ["examples", 0, "why"],
            "before": payload["candidate"]["examples"][0]["why"], "after": self.fixed_why,
            "reason": "Explain the author's choice in relation to the recipient's specific question."}]
        self.requests.append(deepcopy(payload))
        write_json(Path(command[command.index("--output-last-message") + 1]), proposal)
        return SimpleNamespace(returncode=0, wait=lambda timeout=None: 0)

    def run_repair(self, name=None):
        return automatic.repair(self.bundle, self.folder, name or self.base_file,
            self.points, self.author_contract, pipeline.cached_call, timeout=5)

    def existing(self, name=None):
        return automatic.existing_repair(self.bundle, self.folder, name or self.base_file,
            self.points, self.author_contract)

    def evidence(self, candidate):
        return automatic.review_evidence(self.bundle, self.folder, candidate,
            self.points, self.author_contract)

    def test_real_checkpoint_binding_and_resume_never_accept_or_mutate_raw_candidate(self):
        before = deepcopy((self.bundle, self.base, self.points, self.author_contract))
        base_bytes = (self.folder / self.base_file).read_bytes()
        result = self.run_repair()
        expected = deepcopy(self.base)
        expected["examples"][0]["why"] = self.fixed_why
        self.assertEqual(result, expected)
        self.assertEqual(template.validate_lesson(result, self.author_contract), result)
        evidence = self.evidence(result)
        self.assertEqual(len(evidence), 1)
        self.assertEqual(evidence[0]["candidateSha256"], template.value_sha(result))
        model = evidence[0]["proposalEvidence"]["modelProposal"]
        self.assertEqual(model["sha256"], sha(self.folder / model["file"]))
        self.assertEqual(model["requestSha256"], sha((self.folder / model["file"]).with_suffix(".request.json")))
        self.assertEqual(model["invocationSha256"], sha((self.folder / model["file"]).with_suffix(".invocation.json")))
        self.assertEqual((model["role"], model["model"]), ("lesson-field-editor", "gpt-5.6-sol"))
        self.assertTrue(evidence[0]["proposalEvidence"]["requiresIndependentReview"])
        self.assertNotIn("decision", evidence[0])
        snapshot = {p.name: p.read_bytes() for p in self.folder.iterdir()}
        self.assertEqual(self.run_repair(), result)
        self.assertEqual(self.existing(), result)
        self.assertEqual(self.process.call_count, 1)
        self.assertEqual(snapshot, {p.name: p.read_bytes() for p in self.folder.iterdir()})
        self.assertEqual((self.folder / self.base_file).read_bytes(), base_bytes)
        self.assertEqual((self.bundle, self.base, self.points, self.author_contract), before)
        self.assertFalse((self.folder / "verified.json").exists())
        self.assertFalse((self.folder / "lesson.json").exists())

    def test_every_raw_iteration_has_a_distinct_bounded_serial(self):
        pairs = []
        for draft in range(1, 7):
            for repair in range(4):
                name = f"lesson-draft-{draft}" + (f"-repair-{repair}" if repair else "") + ".json"
                proposal, proof = automatic._paths(self.folder, name)
                pairs.append((proposal.name, proof.name))
        self.assertEqual(len(set(pairs)), 24)
        self.assertEqual(pairs[0], ("lesson-field-repair-1.json", "automatic-field-repair-1.json"))
        self.assertEqual(pairs[-1], ("lesson-field-repair-24.json", "automatic-field-repair-24.json"))
        for name in ("../lesson-draft-1.json", "lesson-draft-0.json", "lesson-draft-7.json",
                     "lesson-draft-1-repair-0.json", "lesson-draft-1-repair-4.json",
                     "lesson-draft-01.json", "lesson-draft-1.request.json"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.existing(name)
        self.process.assert_not_called()

    def test_later_different_candidate_does_not_change_older_review_evidence(self):
        first = self.run_repair()
        original_evidence = self.evidence(first)
        original_proof = (self.folder / original_evidence[0]["file"]).read_bytes()
        second_base = deepcopy(self.base)
        second_base["goal"] += " Затем объяснить адресату практическую пользу выбранного порядка."
        name = "lesson-draft-2-repair-3.json"
        self.save_base(name, second_base)
        second = self.run_repair(name)
        self.assertNotEqual(first, second)
        self.assertEqual(self.evidence(first), original_evidence)
        self.assertEqual((self.folder / original_evidence[0]["file"]).read_bytes(), original_proof)
        self.assertEqual([item["file"] for item in self.evidence(second)], ["automatic-field-repair-8.json"])
        unrelated = deepcopy(second)
        unrelated["subtitle"] += " Дополнительная самостоятельная задача."
        self.assertEqual(self.evidence(unrelated), [])
        self.assertEqual(self.existing(), first)
        self.assertEqual(self.existing(name), second)
        self.assertEqual(self.process.call_count, 2)

    def test_identical_result_from_later_base_preserves_first_numeric_proof(self):
        first_name, later_name = "lesson-draft-1-repair-1.json", "lesson-draft-4.json"
        self.save_base(first_name)
        first = self.run_repair(first_name)
        original_evidence = self.evidence(first)
        later_base = deepcopy(self.base)
        later_base["examples"][0]["why"] = "Другая краткая причина."
        self.save_base(later_name, later_base)
        later = self.run_repair(later_name)
        self.assertEqual(later, first)
        self.assertNotEqual(self.requests[0]["baseSha256"], self.requests[1]["baseSha256"])
        self.assertTrue((self.folder / "automatic-field-repair-13.json").is_file())
        self.assertEqual(self.evidence(later), original_evidence)
        self.assertEqual([item["file"] for item in original_evidence], ["automatic-field-repair-2.json"])

    def test_changed_proposal_request_and_invocation_are_rejected(self):
        result = self.run_repair()
        proposal = self.folder / "lesson-field-repair-1.json"
        paths = [proposal, proposal.with_suffix(".request.json"), proposal.with_suffix(".invocation.json")]
        snapshot = {path: path.read_bytes() for path in paths}
        for case in ("proposal-bytes", "proposal-echo", "proposal-change", "request", "invocation", "missing-invocation"):
            with self.subTest(case=case):
                for path, raw in snapshot.items():
                    path.write_bytes(raw)
                if case == "proposal-bytes":
                    proposal.write_bytes(snapshot[proposal] + b"\n")
                elif case in ("proposal-echo", "proposal-change"):
                    value = json.loads(snapshot[proposal])
                    if case == "proposal-echo":
                        value["sourceSetSha256"] = "0" * 64
                    else:
                        value["changes"][0]["after"] += " This was altered after the proposal."
                    write_json(proposal, value)
                elif case == "request":
                    value = json.loads(snapshot[paths[1]])
                    value["payload"]["findings"][0]["issue"] += " Different instructions."
                    value["sha256"] = template.value_sha({k: v for k, v in value.items() if k != "sha256"})
                    write_json(paths[1], value)
                elif case == "invocation":
                    value = json.loads(snapshot[paths[2]])
                    value["model"] = "different-model"
                    write_json(paths[2], value)
                else:
                    paths[2].unlink()
                with self.assertRaises(ValueError):
                    self.evidence(result)
        self.assertEqual(self.process.call_count, 1)

    def test_changed_source_images_and_raw_base_invalidate_existing_proof(self):
        self.run_repair()
        original_bundle = deepcopy(self.bundle)
        base_path = self.folder / self.base_file
        image = Path(self.bundle["attachments"][0]["path"])
        original_base, original_image = base_path.read_bytes(), image.read_bytes()
        for case in ("source", "rehashed-source", "image-bytes", "image-metadata", "base-bytes", "base-candidate"):
            with self.subTest(case=case):
                self.bundle = deepcopy(original_bundle)
                base_path.write_bytes(original_base)
                image.write_bytes(original_image)
                if case in ("source", "rehashed-source"):
                    self.bundle["source"]["text"] += " Changed selected teaching source."
                    if case == "rehashed-source":
                        self.bundle.pop("sourceSetSha256")
                        self.bundle["sourceSetSha256"] = template.value_sha(self.bundle)
                elif case == "image-bytes":
                    image.write_bytes(original_image + b"changed")
                elif case == "image-metadata":
                    self.bundle["attachments"][0]["role"] = "supplement"
                elif case == "base-bytes":
                    base_path.write_bytes(original_base + b"\n")
                else:
                    changed = deepcopy(self.base)
                    changed["goal"] += " Changed current draft."
                    write_json(base_path, changed)
                with self.assertRaises(ValueError):
                    self.existing()
        self.assertEqual(self.process.call_count, 1)

    def test_malformed_or_changed_matching_proof_is_rejected(self):
        result = self.run_repair()
        proof = self.folder / "automatic-field-repair-1.json"
        original = json.loads(proof.read_bytes())
        for case in ("array", "version-bool", "extra-field", "base-path", "proposal-file", "candidate-hash", "evidence"):
            with self.subTest(case=case):
                value = deepcopy(original)
                if case == "array":
                    value = []
                elif case == "version-bool":
                    value["version"] = True
                elif case == "extra-field":
                    value["accepted"] = True
                elif case == "base-path":
                    value["baseFile"] = "../lesson-draft-1.json"
                elif case == "proposal-file":
                    value["proposalFile"] = "lesson-field-repair-2.json"
                elif case == "candidate-hash":
                    value["candidateSha256"] = "0" * 64
                else:
                    value["proposalEvidence"]["modelProposal"]["sha256"] = "0" * 64
                write_json(proof, value)
                with self.assertRaises(ValueError):
                    self.existing()
                if case != "candidate-hash":
                    with self.assertRaises(ValueError):
                        self.evidence(result)
        self.assertEqual(self.process.call_count, 1)

    def test_full_invalid_result_retains_proposal_but_cannot_create_proof(self):
        invalid = deepcopy(self.base)
        invalid["materials"][0]["kind"] = "dialogue"
        self.save_base(self.base_file, invalid)
        raw_bytes = (self.folder / self.base_file).read_bytes()
        self.assertEqual(len(template.lesson_depth_findings(invalid)), 1)
        with self.assertRaisesRegex(ValueError, "listening-script"):
            self.run_repair()
        self.assertEqual(self.process.call_count, 1)
        for suffix in (".json", ".raw.json", ".request.json", ".invocation.json"):
            self.assertTrue((self.folder / ("lesson-field-repair-1" + suffix)).is_file())
        self.assertFalse(list(self.folder.glob("automatic-field-repair-*.json")))
        self.assertFalse((self.folder / "verified.json").exists())
        self.assertEqual((self.folder / self.base_file).read_bytes(), raw_bytes)
        self.assertIsNone(self.existing())


if __name__ == "__main__":
    unittest.main()

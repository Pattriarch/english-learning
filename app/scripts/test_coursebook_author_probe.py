"""Offline author-probe checks with real request, transport and receipt binding."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import coursebook_author_probe as probe
import coursebook_lesson_template as template
import generate_new_coursebooks as pipeline
from test_generate_new_coursebooks import bundle_fixture, isolate_provider_files, write_json


class AuthorProbeTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        isolate_provider_files(self, self.root)
        self.bundle, self.analysis, self.lesson = bundle_fixture(self.root)
        self.unit = self.bundle["chapter"]["unitId"]
        self.enterContext(patch.object(probe, "UNIT", self.unit))
        self.enterContext(patch.object(probe.threading, "active_count", return_value=1))
        self.enterContext(patch.object(pipeline, "codex_command", return_value=["offline-test-codex"]))
        self.enterContext(patch.object(pipeline, "current_bundle", side_effect=self.current_bundle))
        self.process = self.enterContext(patch.object(pipeline.subprocess, "Popen", side_effect=self.fake_process))
        self.origin = self.root / "origin"
        self.work = self.root / "private-probe"
        self.calls = []
        self.invalid_author = False
        self.reject_review = False
        self.bad_review_echo = False
        pipeline.run_analysis(self.bundle, self.origin, timeout=3)
        self.calls.clear()
        self.process.reset_mock()
        self.normal_policy = pipeline.model_policy

    def current_bundle(self, snapshot):
        # Production rebuilds the selected intake. This fixture owns real source
        # and image files, whose hashes still pass the production validator.
        pipeline.validate_bundle(self.bundle)
        return deepcopy(self.bundle)

    @property
    def folder(self):
        return self.work / "units" / self.unit / self.bundle["sourceSetSha256"]

    def fake_process(self, command, **kwargs):
        prompt, raw_payload = kwargs["stdin"].read().split("\nINPUT DATA:\n", 1)
        payload = json.loads(raw_payload)
        schema = pipeline.read(command[command.index("--output-schema") + 1])
        fields = schema["properties"]
        self.assertEqual(command[command.index("--model") + 1], "gpt-6-astra")
        self.assertEqual(command[command.index("--sandbox") + 1], "read-only")
        self.assertFalse(kwargs.get("shell", False))
        self.assertEqual([command[i + 1] for i, value in enumerate(command) if value == "--image"],
                         [item["path"] for item in self.bundle["attachments"]])
        self.assertFalse((self.folder / "verified.json").exists())
        self.calls.append({"prompt": prompt, "payload": deepcopy(payload), "fields": sorted(fields)})
        if "requiredPoints" in fields:
            result = deepcopy(self.analysis)
        elif "sections" in fields:
            result = deepcopy(self.lesson)
            author_input = payload.get("originalInput", payload)
            result["provenance"].update(deepcopy(author_input["requiredProvenance"]))
            result["id"] = "book-" + self.unit
            if self.invalid_author:
                result["sourceCoverage"] = []
        else:
            source_review = "inputSha256" in fields
            result = {"unitId": self.unit, "candidateSha256": payload["candidateSha256"],
                      "decision": "accept", "findings": []}
            result["inputSha256" if source_review else "requestSha256"] = payload[
                "inputSha256" if source_review else "requestSha256"]
            if not source_review:
                if self.reject_review:
                    result.update(decision="revise", findings=[{"pointId": self.analysis["requiredPoints"][0]["id"],
                        "exerciseId": self.lesson["exercises"][0]["id"],
                        "issue": "The learner's explanation does not demonstrate the stated contrast in audience needs."}])
                if self.bad_review_echo:
                    result["candidateSha256"] = "0" * 64
        write_json(command[command.index("--output-last-message") + 1], result)
        return SimpleNamespace(returncode=0, wait=lambda timeout=None: 0)

    def run_probe(self, **kwargs):
        return probe.run(self.origin, self.work, timeout=3, **kwargs)

    def test_scoped_author_policy_restores_on_exception_and_refuses_threads(self):
        with self.assertRaisesRegex(RuntimeError, "bounded test"):
            with probe.author_policy():
                self.assertEqual(pipeline.model_policy(template.LESSON_SCHEMA),
                                 ("lesson-author-probe", "gpt-6-astra"))
                self.assertEqual(pipeline.model_policy(template.REVIEW_SCHEMA),
                                 ("independent-review", "gpt-6-astra"))
                self.assertEqual(pipeline.model_policy(pipeline.ANALYSIS_SCHEMA),
                                 self.normal_policy(pipeline.ANALYSIS_SCHEMA))
                raise RuntimeError("bounded test")
        self.assertIs(pipeline.model_policy, self.normal_policy)
        with patch.object(probe.threading, "active_count", return_value=2):
            with self.assertRaisesRegex(ValueError, "isolated single-thread"):
                with probe.author_policy():
                    self.fail("Concurrent author policy was installed")
        self.assertIs(pipeline.model_policy, self.normal_policy)

    def test_fresh_full_author_and_blind_review_keep_private_result_and_resume_without_calls(self):
        sentinel = "FORBIDDEN_EARLIER_SOL_CANDIDATE_OR_FINDINGS"
        write_json(self.origin / "lesson-draft-1.json", {"goal": sentinel})
        write_json(self.origin / "lesson-review-6.json", {"findings": [sentinel]})
        with patch.object(template, "validate_lesson", wraps=template.validate_lesson) as validate:
            result = self.run_probe()
            self.assertGreaterEqual(validate.call_count, 1)
        self.assertEqual(len(self.calls), 2)
        author, review = self.calls
        expected = pipeline.author_request(self.bundle, self.analysis)
        self.assertEqual(author["prompt"], template.APPLICATION_AUTHOR_PROMPT)
        self.assertEqual(author["payload"], expected["payload"])
        self.assertNotIn("previousCandidate", author["payload"])
        self.assertNotIn("requiredCorrections", author["payload"])
        self.assertNotIn(sentinel, json.dumps(self.calls))
        self.assertEqual(review["payload"]["candidate"], result["lesson"])
        self.assertEqual(review["payload"]["authorInput"], expected["payload"])
        self.assertNotIn("editorialFindings", review["payload"])
        self.assertEqual(result["candidateSha256"], template.value_sha(result["lesson"]))
        self.assertEqual(result["decision"], "accept")
        self.assertFalse(result["publicationReady"])
        self.assertEqual(pipeline.read(self.folder / "probe-result.json"), result)
        self.assertFalse((self.folder / "verified.json").exists())
        self.assertFalse((self.folder / "lesson.json").exists())
        for stem, role in [("lesson-draft-1", "lesson-author-probe"),
                           ("lesson-review-1", "independent-review")]:
            invocation = pipeline.read(self.folder / (stem + ".invocation.json"))
            self.assertEqual((invocation["role"], invocation["model"]), (role, "gpt-6-astra"))
        self.assertEqual(self.run_probe(check_only=True), result)
        self.assertEqual(len(self.calls), 2)
        self.assertIs(pipeline.model_policy, self.normal_policy)

    def test_current_source_and_independently_accepted_analysis_required_before_dispatch(self):
        paths = [self.origin / "source-bundle.json", self.origin / "analysis-verified.json",
                 self.origin / "analysis-review-1.json", Path(self.bundle["sourceFiles"][0]["path"])]
        for index, path in enumerate(paths):
            with self.subTest(path=path.name):
                before = path.read_bytes()
                value = pipeline.read(path)
                if index == 0:
                    value["chapter"]["title"] += " changed"
                elif index == 1:
                    value["analysisSha256"] = "0" * 64
                elif index == 2:
                    value["decision"] = "revise"
                else:
                    value["text"] += " changed source"
                write_json(path, value)
                try:
                    with self.assertRaises(ValueError):
                        self.run_probe()
                    self.process.assert_not_called()
                finally:
                    path.write_bytes(before)

    def test_structural_failure_gets_only_two_repairs_and_never_independent_acceptance(self):
        self.invalid_author = True
        result = self.run_probe()
        self.assertEqual(result["status"], "structural-failure")
        self.assertFalse(result["publicationReady"])
        self.assertEqual(len(self.calls), 3)
        self.assertTrue(all("sections" in call["fields"] for call in self.calls))
        for call in self.calls[1:]:
            self.assertIn("previousCandidate", call["payload"])
            self.assertTrue(call["payload"]["requiredCorrections"])
        self.assertNotIn("decision", result)
        self.assertFalse((self.folder / "lesson-review-1.request.json").exists())
        self.assertFalse((self.folder / "verified.json").exists())
        self.assertIs(pipeline.model_policy, self.normal_policy)

    def test_whole_review_rejection_retained_and_wrong_candidate_echo_rejected(self):
        self.reject_review = True
        result = self.run_probe()
        self.assertEqual(result["status"], "reviewed")
        self.assertEqual(result["decision"], "revise")
        self.assertTrue(result["findings"])
        self.assertFalse(result["publicationReady"])
        self.assertEqual(len(self.calls), 2)
        self.work = self.root / "wrong-echo-probe"
        self.reject_review = False
        self.bad_review_echo = True
        with self.assertRaises(ValueError):
            self.run_probe()
        self.assertFalse((self.folder / "probe-result.json").exists())
        self.assertIs(pipeline.model_policy, self.normal_policy)

    def test_altered_policy_request_source_and_invocation_reject_cached_probe(self):
        self.run_probe()
        files = ["author-probe-policy.json", "lesson-draft-1.request.json",
                 "source-bundle.json", "lesson-draft-1.invocation.json"]
        for name in files:
            path = self.folder / name
            before = path.read_bytes()
            changed = pipeline.read(path)
            if name == files[0]:
                changed["authorModel"] = "gpt-5.6-sol"
            elif name == files[1]:
                changed["payload"]["source"]["text"] += " unbound source"
            elif name == files[2]:
                changed["chapter"]["title"] += " unbound snapshot"
            else:
                changed["role"] = "lesson-author"
                changed["model"] = "gpt-5.6-sol"
            write_json(path, changed)
            try:
                with self.subTest(file=name), self.assertRaises(ValueError):
                    self.run_probe(check_only=True)
            finally:
                path.write_bytes(before)
        self.assertEqual(len(self.calls), 2)

    def test_missing_actual_invocation_cannot_claim_astra_author_or_review(self):
        self.run_probe()
        for name in ("lesson-draft-1.invocation.json", "lesson-review-1.invocation.json"):
            path = self.folder / name
            before = path.read_bytes()
            path.unlink()
            try:
                with self.subTest(file=name), self.assertRaises(ValueError):
                    self.run_probe()
            finally:
                path.write_bytes(before)
        self.assertEqual(len(self.calls), 2)

    def test_legacy_or_non_high_invocation_cannot_claim_high_even_with_rebound_hashes(self):
        self.run_probe()
        result_path = self.folder / "probe-result.json"
        result_bytes = result_path.read_bytes()
        for stem in ("lesson-draft-1", "lesson-review-1"):
            path = self.folder / f"{stem}.invocation.json"
            before = path.read_bytes()
            for case in ("legacy", "missing-high", "different-effort"):
                changed = pipeline.read(path)
                if case == "legacy":
                    changed["version"] = 1
                    changed.pop("reasoningArguments")
                elif case == "missing-high":
                    changed.pop("reasoningArguments")
                else:
                    changed["reasoningArguments"] = ["-c", 'model_reasoning_effort="low"']
                write_json(path, changed)
                record = pipeline.checkpoint_record(self.folder / f"{stem}.json")
                result = json.loads(result_bytes)
                if stem == "lesson-draft-1":
                    result["authorCalls"][0] = record
                else:
                    result["reviewCall"] = record
                write_json(result_path, result)
                try:
                    if case == "legacy":
                        request = pipeline.read(self.folder / f"{stem}.request.json")
                        with probe.author_policy():
                            pipeline.verify_call(record, self.folder,
                                {key: request[key] for key in ("prompt", "payload", "schema")}, self.bundle["attachments"])
                    with self.subTest(stem=stem, case=case), self.assertRaisesRegex(ValueError, "version-2 invocation"):
                        self.run_probe(check_only=True)
                finally:
                    path.write_bytes(before)
                    result_path.write_bytes(result_bytes)
        self.assertEqual(len(self.calls), 2)

    def test_check_only_does_not_dispatch_and_reconstructs_exact_result(self):
        with self.assertRaisesRegex(ValueError, "committed policy"):
            self.run_probe(check_only=True)
        self.process.assert_not_called()
        probe.prepare(self.origin, self.work)
        with self.assertRaisesRegex(ValueError, "cannot dispatch"):
            self.run_probe(check_only=True)
        self.process.assert_not_called()
        self.run_probe()
        path = self.folder / "probe-result.json"
        changed = pipeline.read(path)
        changed["publicationReady"] = True
        write_json(path, changed)
        with self.assertRaisesRegex(ValueError, "reconstructed complete proof"):
            self.run_probe(check_only=True)
        self.assertEqual(len(self.calls), 2)


if __name__ == "__main__":
    unittest.main()

"""Fresh historical-chapter continuations get facts without rewriting receipts."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import coursebook_lesson_template as template
import coursebook_runtime_guidance as runtime
import generate_new_coursebooks as pipeline
from test_generate_new_coursebooks import bundle_fixture, isolate_provider_files, write_json


class RuntimeGuidanceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        isolate_provider_files(self, self.root)
        self.bundle, self.analysis, self.lesson = bundle_fixture(self.root)
        self.author = pipeline.author_request(self.bundle, self.analysis)
        self.author["prompt"] = template.REVISION_AUTHOR_PROMPT
        self.author["sha256"] = template.value_sha({key: self.author[key] for key in ("prompt", "payload", "schema")})
        self.lesson["provenance"].update(deepcopy(self.author["payload"]["requiredProvenance"]))
        self.request = template.build_review_request(self.lesson, self.author)
        self.request = {key: self.request[key] for key in ("prompt", "payload", "schema")}
        self.calls = []
        self.enterContext(patch.object(pipeline, "call_model", side_effect=self.fake_model))

    def fake_model(self, prompt, payload, schema, attachments, path, timeout):
        self.calls.append(deepcopy(payload))
        if "sections" in schema["properties"]:
            result = deepcopy(self.lesson)
        else:
            result = {"unitId": payload["unitId"], "requestSha256": payload["requestSha256"],
                      "candidateSha256": payload["candidateSha256"], "decision": "accept", "findings": []}
        write_json(path, result)
        return result

    def call(self, name, request=None):
        path = self.root / name
        pipeline.cached_call(path, **(request or self.request), attachments=self.bundle["attachments"], timeout=10)
        return path

    def test_fresh_legacy_review_binds_facts_separately_from_untrusted_candidate(self):
        before = deepcopy(self.request)
        path = self.call("lesson-review-1.json")
        record = pipeline.checkpoint_record(path)
        payload = self.calls[-1]
        self.assertEqual(payload[runtime.FIELD], runtime.guidance())
        self.assertEqual(payload["candidate"], self.lesson)
        self.assertEqual(payload["authorInput"], self.author["payload"])
        self.assertEqual(payload["requestSha256"], self.author["sha256"])
        self.assertEqual(self.request, before)
        self.assertEqual(pipeline.verify_call(record, self.root, self.request, self.bundle["attachments"])["decision"], "accept")
        exact = path.with_suffix(".request.json").read_bytes()
        self.call(path.name)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(path.with_suffix(".request.json").read_bytes(), exact)

    def test_old_bound_request_stays_exact_and_retries_without_a_new_supplement(self):
        path = self.root / "lesson-review-1.json"
        transport = pipeline.strict_model_schema(self.request["schema"])
        preimage = {"version": pipeline.VERSION, **self.request, "transportSchema": transport, "attachments": self.bundle["attachments"]}
        write_json(path.with_suffix(".request.json"), {**preimage, "sha256": template.value_sha(preimage)})
        before = path.with_suffix(".request.json").read_bytes()
        self.call(path.name)
        self.assertNotIn(runtime.FIELD, self.calls[-1])
        self.assertEqual(path.with_suffix(".request.json").read_bytes(), before)
        self.assertEqual(pipeline.verify_call(pipeline.checkpoint_record(path), self.root, self.request, self.bundle["attachments"])["decision"], "accept")

    def test_new_legacy_semantic_and_format_repairs_get_fact_payloads(self):
        logical = pipeline.revised_request(self.author, self.lesson, ["Correct a specific meaning without removing tasks."])
        for name in ("lesson-draft-2.json", "lesson-draft-1-repair-1.json"):
            path = self.call(name, logical)
            self.assertEqual(self.calls[-1][runtime.FIELD], runtime.guidance())
            self.assertEqual(self.calls[-1]["originalInput"], self.author["payload"])
            self.assertEqual(pipeline.verify_call(pipeline.checkpoint_record(path), self.root,
                             logical, self.bundle["attachments"]), self.lesson)

    def test_initial_new_contract_source_and_editorial_calls_do_not_receive_duplicate_facts(self):
        for name, logical in (("lesson-draft-1.json", {key: self.author[key] for key in ("prompt", "payload", "schema")}),
                              ("analysis-review-1.json", self.request), ("lesson-editorial-review-1.json", self.request)):
            self.assertNotIn(runtime.FIELD, runtime.effective_request(name, logical)["payload"])
        current = deepcopy(self.request)
        current["prompt"] += "\n" + template.APPLICATION_AUTHOR_GUIDANCE
        self.assertEqual(runtime.effective_request("lesson-review-1.json", current), current)

    def test_guidance_is_frozen_versioned_and_separate_from_future_template_edits(self):
        self.assertEqual(runtime.GUIDANCE_V1, template.APPLICATION_AUTHOR_GUIDANCE)
        exact = runtime.guidance()
        with patch.object(template, "APPLICATION_AUTHOR_GUIDANCE", "Future interface policy"):
            self.assertEqual(runtime.guidance(), exact)
        for key, value in (("version", 2), ("source", "candidate-claim"), ("text", "Auto random choices exist"), ("sha256", "0" * 64)):
            committed = deepcopy(self.request)
            committed["payload"][runtime.FIELD] = {**runtime.guidance(), key: value}
            with self.subTest(key=key), self.assertRaises(ValueError):
                runtime.effective_request("lesson-review-1.json", self.request, committed, allow_fresh=False)

    def test_tampered_fact_contract_cannot_pass_even_with_recomputed_file_and_request_hash(self):
        path = self.call("lesson-review-1.json")
        binding = path.with_suffix(".request.json")
        committed = pipeline.read(binding)
        committed["payload"][runtime.FIELD]["text"] = "Invented automatic turn-level selection."
        committed["payload"][runtime.FIELD]["sha256"] = template.text_sha(committed["payload"][runtime.FIELD]["text"])
        committed["sha256"] = template.value_sha({key: value for key, value in committed.items() if key != "sha256"})
        write_json(binding, committed)
        with self.assertRaisesRegex(ValueError, "Runtime guidance"):
            pipeline.verify_call(pipeline.checkpoint_record(path), self.root, self.request, self.bundle["attachments"])

    def test_bound_legacy_repair_reconstructs_exact_errors_with_fact_supplement(self):
        logical = pipeline.revised_request(self.author, self.lesson, ["Historical precise error wording."])
        path = self.call("lesson-draft-1-repair-1.json", logical)
        recovered = pipeline.legacy_identity_repair(path, self.author, self.lesson, self.bundle["attachments"])
        self.assertEqual(recovered["payload"][runtime.FIELD], runtime.guidance())
        before = path.with_suffix(".request.json").read_bytes()
        self.call(path.name, recovered)
        self.assertEqual(path.with_suffix(".request.json").read_bytes(), before)

    def test_fresh_supplement_is_part_of_exact_invocation_payload_proof(self):
        path = self.call("lesson-review-1.json")
        request = pipeline.read(path.with_suffix(".request.json"))
        role, model = pipeline.model_policy(self.request["schema"])
        invocation = {"version": 2, "role": role, "model": model,
            "requestSha256": pipeline.file_sha(path.with_suffix(".request.json")),
            "promptSha256": template.text_sha(request["prompt"]),
            "payloadSha256": template.value_sha(request["payload"]),
            "schemaSha256": template.value_sha(request["schema"]),
            "transportSchemaSha256": template.value_sha(request["transportSchema"]),
            "attachments": self.bundle["attachments"], "httpArguments": pipeline.codex_http_arguments(),
            "reasoningArguments": pipeline.REASONING_ARGUMENTS}
        invocation_path = path.with_suffix(".invocation.json")
        write_json(invocation_path, invocation)
        self.assertEqual(pipeline.verify_call(pipeline.checkpoint_record(path), self.root,
            self.request, self.bundle["attachments"])["decision"], "accept")
        invocation["payloadSha256"] = template.value_sha(self.request["payload"])
        write_json(invocation_path, invocation)
        with self.assertRaisesRegex(ValueError, "invocation"):
            pipeline.verify_call(pipeline.checkpoint_record(path), self.root, self.request, self.bundle["attachments"])

    def test_recovery_first_request_keeps_author_identity_and_reconstructs_new_supplement(self):
        findings = ["Repair the complete retained candidate against all source points."]
        seed = {"nextDraft": 2, "candidate": self.lesson, "findings": findings}
        logical = pipeline.revised_request(self.author, self.lesson, findings)
        path = self.call("lesson-draft-2.json", logical)
        before = path.with_suffix(".request.json").read_bytes()
        with patch.object(pipeline, "recovery_seed", return_value=seed):
            restored = pipeline.author_request(self.bundle, self.analysis, self.root)
        self.assertEqual(restored, self.author)
        self.assertEqual(path.with_suffix(".request.json").read_bytes(), before)

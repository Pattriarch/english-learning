"""Exact new echo constraints and immutable legacy transport compatibility."""
from copy import deepcopy
import unittest

from coursebook_transport_schema import bind_echo_fields, permitted_transport


class TransportEchoTests(unittest.TestCase):
    def setUp(self):
        self.schema = {"type": "object", "properties": {
            "unitId": {"type": "string"},
            "candidateSha256": {"type": "string", "pattern": "[a-f0-9]{64}"},
            "decision": {"type": "string", "enum": ["accept", "revise"]},
            "findings": {"type": "array", "items": {"type": "string"}}},
            "required": ["unitId", "candidateSha256", "decision", "findings"],
            "additionalProperties": False}
        self.payload = {"unitId": "clear-speech-3-007", "candidateSha256": "a" * 64,
                        "decision": "accept", "findings": []}

    def test_binds_only_known_identity_fields_and_never_constrains_decision_or_content(self):
        before = deepcopy(self.schema)
        bound = bind_echo_fields(self.schema, self.payload)
        self.assertEqual(bound["properties"]["unitId"]["enum"], [self.payload["unitId"]])
        self.assertEqual(bound["properties"]["candidateSha256"]["enum"], ["a" * 64])
        self.assertEqual(bound["properties"]["candidateSha256"]["pattern"], "[a-f0-9]{64}")
        self.assertEqual(bound["properties"]["decision"], before["properties"]["decision"])
        self.assertEqual(bound["properties"]["findings"], before["properties"]["findings"])
        self.assertEqual(self.schema, before)

    def test_missing_or_nonstring_echo_values_do_not_invent_metadata(self):
        self.assertEqual(bind_echo_fields(self.schema, {}), self.schema)
        self.assertEqual(bind_echo_fields(self.schema, {"unitId": None}), self.schema)

    def test_reused_native_hash_dictionary_does_not_alias_bound_values(self):
        shared = {"type": "string", "pattern": "[a-f0-9]{64}"}
        schema = {"type": "object", "properties": {"requestSha256": shared, "candidateSha256": shared}}
        result = bind_echo_fields(schema, {"requestSha256": "a" * 64, "candidateSha256": "b" * 64})
        self.assertEqual(result["properties"]["requestSha256"]["enum"], ["a" * 64])
        self.assertEqual(result["properties"]["candidateSha256"]["enum"], ["b" * 64])
        self.assertNotIn("enum", shared)

    def test_exact_legacy_and_current_transports_remain_readable_without_rewriting(self):
        original = deepcopy(self.schema)
        self.assertEqual(permitted_transport(self.schema, self.payload, original), original)
        current = bind_echo_fields(self.schema, self.payload)
        self.assertEqual(permitted_transport(self.schema, self.payload), current)
        self.assertEqual(permitted_transport(self.schema, self.payload, current), current)
        self.assertEqual(original, self.schema)

    def test_wrong_echo_or_weakened_content_contract_cannot_be_relabelled_as_legacy(self):
        wrong = bind_echo_fields(self.schema, self.payload)
        wrong["properties"]["candidateSha256"]["enum"] = ["b" * 64]
        with self.assertRaises(ValueError):
            permitted_transport(self.schema, self.payload, wrong)
        weakened = deepcopy(self.schema)
        weakened["properties"]["decision"]["enum"] = ["accept"]
        with self.assertRaises(ValueError):
            permitted_transport(self.schema, self.payload, weakened)


if __name__ == "__main__":
    unittest.main()

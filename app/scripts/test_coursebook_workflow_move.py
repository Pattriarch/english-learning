"""Relocate one task without changing other workflow or content state."""
from copy import deepcopy
import unittest
from coursebook_workflow_move import apply_move


class WorkflowMoveTests(unittest.TestCase):
    def setUp(self):
        self.base = {"exercises": [{"id": key, "prompt": "Same full learner task"} for key in ("d", "i1", "i2", "p1", "p2", "prod", "rev", "t")],
            "studyPlan": {"stages": [{"id": name, "exerciseIds": ids, "minutes": 20, "purpose": "Untouched"} for name, ids in (
                ("diagnostic", ["d"]), ("input", ["i1", "i2"]), ("practice", ["p1", "p2"]), ("production", ["prod"]), ("revision", ["rev"]), ("transfer", ["t"]))]}}
        self.move = {"exerciseId": "i2", "fromStage": "input", "toStage": "practice", "beforeFrom": ["i1", "i2"],
                     "beforeTo": ["p1", "p2"], "afterId": "p2", "reason": "Place the final assessment after the exact prerequisites it is intended to assess."}

    def test_exact_move_preserves_all_content_other_order_and_metadata(self):
        original = deepcopy(self.base)
        expected = deepcopy(self.base)
        expected["studyPlan"]["stages"][1]["exerciseIds"] = ["i1"]
        expected["studyPlan"]["stages"][2]["exerciseIds"] = ["p1", "p2", "i2"]
        self.assertEqual(apply_move(self.base, self.move), expected)
        self.assertEqual(self.base, original)

    def test_rejects_stale_lists_unknown_duplicate_or_wrong_destination(self):
        for key, value in (("beforeFrom", ["i2", "i1"]), ("beforeTo", ["p2", "p1"]),
                           ("exerciseId", "missing"), ("exerciseId", "p1"), ("afterId", "missing"),
                           ("fromStage", "revision"), ("toStage", "production")):
            changed = deepcopy(self.move); changed[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError): apply_move(self.base, changed)
        self.base["studyPlan"]["stages"][5]["exerciseIds"].append("i2")
        with self.assertRaises(ValueError): apply_move(self.base, self.move)

    def test_cannot_change_minutes_types_other_fields_or_multiple_ids(self):
        for key, value in (("minutes", 10), ("kind", "speak"), ("additionalMoves", []), ("exerciseId", ["i1", "i2"])):
            changed = deepcopy(self.move); changed[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): apply_move(self.base, changed)

    def test_requires_real_reason_unique_stages_and_existing_task(self):
        changed = deepcopy(self.move); changed["reason"] = "short"
        with self.assertRaises(ValueError): apply_move(self.base, changed)
        changed_base = deepcopy(self.base); changed_base["studyPlan"]["stages"].append(deepcopy(changed_base["studyPlan"]["stages"][1]))
        with self.assertRaises(ValueError): apply_move(changed_base, self.move)
        self.base["exercises"] = [exercise for exercise in self.base["exercises"] if exercise["id"] != "i2"]
        with self.assertRaises(ValueError): apply_move(self.base, self.move)

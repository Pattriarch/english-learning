"""One exact input/practice task relocation, never a lesson acceptance."""
from collections import Counter
from copy import deepcopy

_FIELDS = {"exerciseId", "fromStage", "toStage", "beforeFrom", "beforeTo", "afterId", "reason"}


def apply_move(base, move):
    if not isinstance(move, dict) or set(move) != _FIELDS:
        raise ValueError("Workflow move requires one exact bounded operation")
    if ({move["fromStage"], move["toStage"]} != {"input", "practice"}
            or not isinstance(move["reason"], str) or len(move["reason"].strip()) < 30):
        raise ValueError("Workflow move is limited to input/practice with an explicit pedagogical reason")
    stages = base["studyPlan"]["stages"]
    selected = {name: [stage for stage in stages if stage["id"] == name] for name in ("input", "practice")}
    if any(len(rows) != 1 for rows in selected.values()):
        raise ValueError("Workflow move needs unique input and practice stages")
    source = selected[move["fromStage"]][0]["exerciseIds"]
    target = selected[move["toStage"]][0]["exerciseIds"]
    if source != move["beforeFrom"] or target != move["beforeTo"]:
        raise ValueError("Workflow move source or destination order changed")
    exercise_id, after_id = move["exerciseId"], move["afterId"]
    all_ids = [exercise for stage in stages for exercise in stage["exerciseIds"]]
    if (not isinstance(exercise_id, str) or source.count(exercise_id) != 1
            or Counter(all_ids)[exercise_id] != 1 or len(all_ids) != len(set(all_ids))
            or [exercise["id"] for exercise in base["exercises"]].count(exercise_id) != 1
            or not isinstance(after_id, str) or target.count(after_id) != 1):
        raise ValueError("Workflow move must relocate one existing unique task after one existing destination task")
    candidate = deepcopy(base)
    new_source = next(stage for stage in candidate["studyPlan"]["stages"] if stage["id"] == move["fromStage"])["exerciseIds"]
    new_target = next(stage for stage in candidate["studyPlan"]["stages"] if stage["id"] == move["toStage"])["exerciseIds"]
    new_source.remove(exercise_id)
    new_target.insert(new_target.index(after_id) + 1, exercise_id)
    if Counter(all_ids) != Counter(exercise for stage in candidate["studyPlan"]["stages"] for exercise in stage["exerciseIds"]):
        raise ValueError("Workflow move changed task coverage")
    return candidate

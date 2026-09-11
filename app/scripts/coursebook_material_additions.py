"""Append at most two original listening stimuli with exact existing task links.

This editorial operation does not validate pedagogy or grant acceptance. The
complete resulting chapter still needs the normal validator and a fresh review.
"""
from copy import deepcopy
import re

_FIELDS = {"beforeMaterialIds", "items"}
_ITEM = {"material", "exerciseLinks", "reason"}
_MATERIAL = {"id", "title", "kind", "text", "source", "inputSkill"}
_LINK = {"exerciseId", "beforeMaterialIds"}
_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def apply_additions(base, bundle, additions):
    """Keep every old material and task; append only declared original scripts."""
    if not isinstance(additions, dict) or set(additions) != _FIELDS:
        raise ValueError("Original material additions require exact bounded fields")
    materials, exercises = base.get("materials"), base.get("exercises")
    if not isinstance(materials, list) or not isinstance(exercises, list):
        raise ValueError("Original material additions require existing materials and exercises")
    existing_ids = [item["id"] for item in materials]
    exercise_ids = [item["id"] for item in exercises]
    if (existing_ids != additions["beforeMaterialIds"] or len(set(existing_ids)) != len(existing_ids)
            or len(set(exercise_ids)) != len(exercise_ids)):
        raise ValueError("Original material additions source identity or order changed")
    items = additions["items"]
    if not isinstance(items, list) or not 1 <= len(items) <= 2 or len(materials) + len(items) > 30:
        raise ValueError("Original material additions allow one or two stimuli within the chapter limit")
    protected_ids = set(existing_ids) | set(exercise_ids) | {item["id"] for item in bundle.get("approvedMaterials", [])}
    linked_tasks = set()
    candidate = deepcopy(base)
    by_exercise = {exercise["id"]: exercise for exercise in candidate["exercises"]}
    for item in items:
        if (not isinstance(item, dict) or set(item) != _ITEM or not isinstance(item["reason"], str)
                or len(item["reason"].strip()) < 30):
            raise ValueError("Original stimulus needs an exact pedagogical reason and task links")
        material = item["material"]
        if (not isinstance(material, dict) or set(material) != _MATERIAL
                or any(not isinstance(material[key], str) for key in _MATERIAL)
                or not _ID.fullmatch(material["id"]) or material["id"] in protected_ids
                or material["kind"] != "listening" or material["inputSkill"] != "listening-script"
                or material["source"] != "Original course adaptation"
                or not 3 <= len(material["title"].strip()) <= 160
                or not 20 <= len(material["text"].strip()) <= 12000
                or re.search(r"https?://|file:|/book-recordings/|/assets/", material["text"], re.I)):
            raise ValueError("New material must be a unique original synthesis script without source assets")
        links = item["exerciseLinks"]
        if not isinstance(links, list) or not 1 <= len(links) <= 4:
            raise ValueError("Each original stimulus needs one to four exact existing task links")
        for link in links:
            if not isinstance(link, dict) or set(link) != _LINK:
                raise ValueError("Original material link requires exact existing task identity")
            exercise_id = link["exerciseId"]
            if not isinstance(exercise_id, str) or exercise_id not in by_exercise or exercise_id in linked_tasks:
                raise ValueError("Original material link must target one unique existing exercise")
            exercise = by_exercise[exercise_id]
            before = exercise.get("materialIds", [])
            if (not isinstance(link["beforeMaterialIds"], list) or before != link["beforeMaterialIds"]
                    or len(before) != len(set(before))):
                raise ValueError("Original material task links changed before the append")
            exercise["materialIds"] = [*before, material["id"]]
            linked_tasks.add(exercise_id)
        candidate["materials"].append(deepcopy(material))
        protected_ids.add(material["id"])
    return candidate

"""Apply a narrow, hash-bound editorial proposal in memory before fresh review.

This loader grants no acceptance and writes no files. Supplied materials,
material references and identifiers cannot be patched. Direct editorial edits
may fix text or its authored source caption in an explicitly original material
without external assets, retaining its original-work attribution. The
caller must validate the whole lesson and obtain independent review of it.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re

from coursebook_lesson_template import value_sha


_SHA = re.compile(r"[a-f0-9]{64}")
_BASE = re.compile(r"lesson-draft-[1-6](?:-repair-[1-3])?\.json")
_UNIT = re.compile(r"[a-z0-9][a-z0-9-]*")
_PATCH_FIELDS = {"version", "sourceSetSha256", "unitId", "baseFile",
                 "baseSha256", "baseCandidateSha256", "changes"}
_CHANGE_FIELDS = {"path", "before", "after", "reason"}


def _fail(message):
    raise ValueError("Editorial patch: " + message)


def _json(raw, description):
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Editorial patch: invalid {description} JSON") from error
    if not isinstance(value, dict):
        _fail(description + " must be an object")
    return value


def _index(value):
    return type(value) is int and value >= 0


def _allowed(path):
    if not isinstance(path, list) or not path:
        return False
    if len(path) == 1:
        return path[0] in ("subtitle", "goal", "formula")
    if (len(path) == 4 and path[:2] == ["studyPlan", "stages"]
            and _index(path[2])):
        return path[3] == "purpose"
    if len(path) == 3 and _index(path[1]):
        return ((path[0] == "sections" and path[2] == "body")
                or (path[0] == "examples" and path[2] in ("en", "ru", "why"))
                or (path[0] == "exercises" and path[2] in
                    ("prompt", "context", "hint", "explanation")))
    return (len(path) == 4 and path[0] == "exercises" and _index(path[1])
            and path[2] == "answers" and _index(path[3]))


def _leaf(candidate, path):
    node = candidate
    for key in path:
        if isinstance(node, dict) and isinstance(key, str) and key in node:
            node = node[key]
        elif isinstance(node, list) and _index(key) and key < len(node):
            node = node[key]
        else:
            _fail("path does not identify an existing leaf: " + repr(path))
    if not isinstance(node, str):
        _fail("only existing string leaves can change: " + repr(path))
    return node


def _original_source_label(source):
    return (isinstance(source, str)
            and bool(re.match(r"^(?:Original\b|Оригиналь(?:ный|ная|ное|ные)\b)", source.strip(), re.I))
            and not re.search(r"\b(?:supplied|textbook|transcript|source|book)\b|учебник|расшифров|исходн|из\s+книг", source, re.I))


def _application_warning(path, base, after):
    # Author-written UI caveats are prose, not source-image/audio provenance.
    # Keep this outside the automatic field-editor's narrower whitelist.
    if not (isinstance(path, list) and len(path) == 3
            and path[:2] == ["provenance", "warnings"] and _index(path[2])):
        return False
    warnings = base.get("provenance", {}).get("warnings", [])
    ui = re.compile(r"\bapplication\b|\bприложени[еяию]\b", re.I)
    return (isinstance(warnings, list) and path[2] < len(warnings)
            and isinstance(warnings[path[2]], str) and isinstance(after, str)
            and bool(ui.search(warnings[path[2]])) and bool(ui.search(after)))


def _original_material_text(path, base, bundle, after):
    # Keep _allowed unchanged: the automated field editor deliberately uses
    # that narrower scope. This exception belongs to direct editorial work.
    if not (isinstance(path, list) and len(path) == 3 and path[0] == "materials"
            and _index(path[1]) and path[2] in {"text", "source"}):
        return False
    materials, supplied = base.get("materials"), bundle.get("approvedMaterials", [])
    if (not isinstance(materials, list) or path[1] >= len(materials)
            or not isinstance(supplied, list)
            or any(not isinstance(item, dict) or not isinstance(item.get("id"), str) for item in supplied)):
        return False
    material = materials[path[1]]
    if (not isinstance(material, dict)
            or not set(material) <= {"id", "title", "kind", "text", "source", "inputSkill"}
            or material.get("kind") not in {"reading", "dialogue", "listening", "reference"}
            or not isinstance(material.get("id"), str) or not _UNIT.fullmatch(material["id"])
            or not isinstance(material.get("source"), str)):
        return False
    identifier, source = material["id"], material["source"].strip()
    if (sum(isinstance(item, dict) and item.get("id") == identifier for item in materials) != 1
            or identifier in {item["id"] for item in supplied}):
        return False
    # An original-work label is a claim to check in the subsequent full review,
    # not proof of authorship. Ambiguous labels mentioning source transcripts or
    # a supplied textbook remain outside this repair scope.
    return bool(_original_source_label(source)
                and (path[2] == "text" or (
                    _original_source_label(after) and ";" in source
                    and after == source.split(";", 1)[0].strip())))


def apply_changes(base, bundle, changes):
    """Apply exact editorial leaves in memory; never grant review acceptance.

    This also serves a caller whose exact base comes from a verified historical
    review request instead of a raw draft. That caller must independently bind
    the base's provenance and obtain a fresh review of the complete result.
    """
    if (not isinstance(base, dict) or not isinstance(bundle, dict)
            or not isinstance(bundle.get("chapter"), dict)):
        _fail("invalid current source bundle or base candidate")
    unit_id, source_sha = bundle["chapter"].get("unitId"), bundle.get("sourceSetSha256")
    if (not isinstance(unit_id, str) or not _UNIT.fullmatch(unit_id)
            or not isinstance(source_sha, str) or not _SHA.fullmatch(source_sha)
            or value_sha({key: value for key, value in bundle.items() if key != "sourceSetSha256"}) != source_sha):
        _fail("current source bundle self-hash or unit changed")
    if base.get("id") != "book-" + unit_id:
        _fail("base candidate must already have the canonical book-unit ID")
    if not isinstance(changes, list) or not changes:
        _fail("changes must be a nonempty list")
    paths = []
    for change in changes:
        if not isinstance(change, dict) or set(change) != _CHANGE_FIELDS:
            _fail("unexpected change fields")
        path = change["path"]
        if not (_allowed(path) or _original_material_text(path, base, bundle, change["after"])
                or _application_warning(path, base, change["after"])):
            _fail("forbidden editorial field path: " + repr(path))
        if any(path[:len(prior)] == prior or prior[:len(path)] == path for prior in paths):
            _fail("duplicate or overlapping editorial field paths")
        paths.append(path)
        before, after, reason = change["before"], change["after"], change["reason"]
        if not isinstance(before, str) or _leaf(base, path) != before:
            _fail("before text does not match the exact base leaf: " + repr(path))
        if not isinstance(after, str) or not after.strip() or after == before:
            _fail("after text must be a nonempty different string: " + repr(path))
        if not isinstance(reason, str) or len(reason.strip()) < 20:
            _fail("each change needs a reason of at least 20 characters")
    candidate = deepcopy(base)
    for change in changes:
        node = candidate
        for key in change["path"][:-1]:
            node = node[key]
        node[change["path"][-1]] = change["after"]
    return candidate


def load_patch(bundle, folder):
    """Return ``(candidate, evidence)`` or None when no patch file exists.

    A present invalid patch always raises ValueError. Source-set self-hash,
    source/unit binding, raw base bytes, parsed base value and canonical base ID
    are checked before any proposed field is changed. Evidence hashes the exact
    patch bytes and recomputed final candidate; it is not a review receipt.
    """
    folder = Path(folder)
    patch_path = folder / "editorial-patch.json"
    if not patch_path.exists():
        return None
    if not patch_path.is_file() or patch_path.resolve().parent != folder.resolve():
        _fail("patch must be a local file in its chapter folder")
    raw_patch = patch_path.read_bytes()
    patch = _json(raw_patch, "proposal")
    if set(patch) != _PATCH_FIELDS or type(patch.get("version")) is not int or patch["version"] != 1:
        _fail("unexpected proposal fields or version")
    if not isinstance(bundle, dict) or not isinstance(bundle.get("chapter"), dict):
        _fail("invalid current source bundle")
    source_sha = bundle.get("sourceSetSha256")
    unit_id = bundle["chapter"].get("unitId")
    if (not isinstance(source_sha, str) or not _SHA.fullmatch(source_sha)
            or value_sha({key: value for key, value in bundle.items()
                          if key != "sourceSetSha256"}) != source_sha):
        _fail("current source bundle self-hash changed")
    if not isinstance(unit_id, str) or not _UNIT.fullmatch(unit_id):
        _fail("invalid current unit ID")
    if patch["sourceSetSha256"] != source_sha or patch["unitId"] != unit_id:
        _fail("source-set or unit binding changed")
    base_name = patch["baseFile"]
    if not isinstance(base_name, str) or not _BASE.fullmatch(base_name):
        _fail("invalid baseFile; an existing lesson draft basename is required")
    base_path = folder / base_name
    if not base_path.is_file() or base_path.resolve().parent != folder.resolve():
        _fail("base file is missing or outside its chapter folder")
    raw_base = base_path.read_bytes()
    base_sha = hashlib.sha256(raw_base).hexdigest()
    if patch["baseSha256"] != base_sha:
        _fail("base file bytes changed")
    base = _json(raw_base, "base candidate")
    if patch["baseCandidateSha256"] != value_sha(base):
        _fail("base candidate value hash changed")
    if base.get("id") != "book-" + unit_id:
        _fail("base candidate must already have the canonical book-unit ID")
    changes = patch["changes"]
    candidate = apply_changes(base, bundle, changes)
    evidence = {"file": patch_path.name, "sha256": hashlib.sha256(raw_patch).hexdigest(),
                "baseFile": base_name, "baseSha256": base_sha,
                "candidateSha256": value_sha(candidate),
                "changes": [{"path": deepcopy(change["path"]), "reason": change["reason"]}
                            for change in changes]}
    return candidate, evidence

"""Load exact failed-draft data for a later full-candidate repair, read-only.

A recovery seed can be structurally or substantively flawed. It is never an
accepted lesson or a reusable review. The caller owns failed-job selection,
live source validation, exact cached-call binding, complete candidate repair,
structural validation and fresh independent semantic review.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re

from coursebook_lesson_template import value_sha


_FIELDS = {"version", "unitId", "sourceSetSha256", "baseFile", "baseSha256",
           "candidateSha256", "nextDraft", "findings", "reason"}
_FINDING_FIELDS = {"pointId", "exerciseId", "issue"}
_BASE = re.compile(r"lesson-draft-([1-6])(?:-repair-[1-3])?\.json")
_ID = re.compile(r"[a-z0-9][a-z0-9-]*")
_SHA = re.compile(r"[a-f0-9]{64}")


def _fail(message):
    raise ValueError("Recovery seed: " + message)


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _object_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _fail("duplicate JSON object key: " + key)
        result[key] = value
    return result


def _read(path):
    try:
        raw = path.read_bytes()
        value = json.loads(raw.decode("utf-8-sig"), object_pairs_hook=_object_pairs)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Recovery seed: unreadable or invalid JSON artifact") from error
    if not isinstance(value, dict):
        _fail("artifact must be a JSON object")
    return raw, value


def _local(path, folder):
    if not path.is_file() or path.resolve().parent != folder:
        _fail("artifact must be an existing local file in its chapter folder")


def _long_string(value, minimum):
    return isinstance(value, str) and len(value.strip()) >= minimum


def load_recovery_seed(bundle, folder):
    """Return None or {candidate,findings,nextDraft,evidence}, without writes.

    A present invalid control raises ValueError. Existing next-draft checkpoints
    are allowed: only the caller's exact cached request can authorize their
    reuse. No raw content, provenance, IDs or review echoes are normalized.
    """
    folder = Path(folder).resolve()
    control_path = folder / "lesson-recovery.json"
    if not control_path.exists() and not control_path.is_symlink():
        return None
    _local(control_path, folder)
    control_raw, control = _read(control_path)
    if set(control) != _FIELDS or type(control["version"]) is not int or control["version"] != 1:
        _fail("unexpected control fields or version")
    if not isinstance(bundle, dict) or not isinstance(bundle.get("chapter"), dict):
        _fail("invalid current source bundle")
    source_sha = bundle.get("sourceSetSha256")
    if (not isinstance(source_sha, str) or not _SHA.fullmatch(source_sha)
            or source_sha != value_sha({k: v for k, v in bundle.items() if k != "sourceSetSha256"})):
        _fail("current source bundle self-hash changed")
    chapter = bundle["chapter"]
    for key in ("unitId", "bookId"):
        if not isinstance(chapter.get(key), str) or not _ID.fullmatch(chapter[key]):
            _fail("invalid current chapter " + key)
    if control["unitId"] != chapter["unitId"] or control["sourceSetSha256"] != source_sha:
        _fail("control source-set or unit binding changed")
    base_name = control["baseFile"]
    match = _BASE.fullmatch(base_name) if isinstance(base_name, str) else None
    if match is None:
        _fail("baseFile must name an existing lesson draft")
    next_draft = control["nextDraft"]
    if type(next_draft) is not int or not 2 <= next_draft <= 6 or next_draft <= int(match[1]):
        _fail("nextDraft must be 2..6 and strictly later than the raw base draft")
    findings = control["findings"]
    if not isinstance(findings, list) or not 1 <= len(findings) <= 40:
        _fail("findings must contain 1..40 precise issues")
    for finding in findings:
        if isinstance(finding, str):
            valid = _long_string(finding, 20)
        else:
            valid = (isinstance(finding, dict) and set(finding) == _FINDING_FIELDS
                     and isinstance(finding["pointId"], str)
                     and isinstance(finding["exerciseId"], str)
                     and _long_string(finding["issue"], 20))
        if not valid:
            _fail("each finding must be a >=20-character issue or an exact review finding object")
    if not _long_string(control["reason"], 30):
        _fail("reason must have at least 30 characters")
    base_path = folder / base_name
    _local(base_path, folder)
    base_raw, candidate = _read(base_path)
    if control["baseSha256"] != _sha(base_raw):
        _fail("raw base file bytes changed")
    candidate_sha = value_sha(candidate)
    if control["candidateSha256"] != candidate_sha:
        _fail("raw candidate value hash changed")
    provenance = candidate.get("provenance")
    if (not isinstance(provenance, dict) or provenance.get("unitId") != chapter["unitId"]
            or provenance.get("bookId") != chapter["bookId"]):
        _fail("raw candidate provenance unit/book differs from current source")
    if control_path.read_bytes() != control_raw or base_path.read_bytes() != base_raw:
        _fail("recovery artifacts changed while being read")
    evidence = {"version": 1, "status": "unverified-recovery-seed",
        "requiresIndependentReview": True, "file": control_path.name,
        "sha256": _sha(control_raw), "unitId": chapter["unitId"],
        "sourceSetSha256": source_sha, "baseFile": base_name,
        "baseSha256": _sha(base_raw), "candidateSha256": candidate_sha,
        "nextDraft": next_draft, "reason": control["reason"],
        "findingsSha256": value_sha(findings)}
    return {"candidate": deepcopy(candidate), "findings": deepcopy(findings),
            "nextDraft": next_draft, "evidence": evidence}

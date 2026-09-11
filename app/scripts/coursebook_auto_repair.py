"""Candidate-bound repairs of measured text-depth defects, never acceptance."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re

from build_book_lessons import atomic_json
import coursebook_field_repair as editor
import coursebook_lesson_template as template
from coursebook_depth_edits import depth_edit_findings

_BASE = re.compile(r"lesson-draft-([1-6])(?:-repair-([1-3]))?\.json")
_PROOF = re.compile(r"automatic-field-repair-(\d+)\.json")
_FIELDS = {"version", "kind", "baseFile", "proposalFile", "candidateSha256", "proposalEvidence"}
KIND = "coursebook-automatic-depth-repair-v1"


def _read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _paths(folder, base_file):
    match = _BASE.fullmatch(base_file)
    if match is None:
        raise ValueError("Automatic text repair needs an exact raw draft filename")
    serial = (int(match[1]) - 1) * 4 + int(match[2] or 0) + 1
    return Path(folder) / f"lesson-field-repair-{serial}.json", Path(folder) / f"automatic-field-repair-{serial}.json"


def _request(bundle, folder, base_file, required_points):
    candidate = _read(Path(folder) / base_file)
    findings = depth_edit_findings(candidate)
    if not findings:
        raise ValueError("Automatic text repair has no measured existing-leaf defect")
    return editor.build_request(bundle, folder, base_file, required_points, findings)


def _prepared(bundle, folder, base_file, required_points, author_contract):
    proposal_path, proof_path = _paths(folder, base_file)
    request = _request(bundle, folder, base_file, required_points)
    prepared = editor.prepare_patch(bundle, folder, request, proposal_path)
    # The complete result must pass every workflow, source, material, range and
    # depth requirement before a proof exists or a semantic review can use it.
    candidate = template.validate_lesson(prepared["candidate"], author_contract)
    record = {"version": 1, "kind": KIND, "baseFile": base_file,
        "proposalFile": proposal_path.name, "candidateSha256": template.value_sha(candidate),
        "proposalEvidence": prepared["evidence"]}
    return candidate, record, proof_path


def _checked(bundle, folder, proof_path, required_points, author_contract):
    folder = Path(folder).resolve()
    proof_path = Path(proof_path)
    if proof_path.resolve().parent != folder or not _PROOF.fullmatch(proof_path.name):
        raise ValueError("Automatic text repair proof is outside the chapter")
    before = proof_path.read_bytes()
    record = json.loads(before.decode("utf-8-sig"))
    if (not isinstance(record, dict) or set(record) != _FIELDS or type(record.get("version")) is not int
            or record.get("version") != 1 or record.get("kind") != KIND):
        raise ValueError("Invalid automatic text repair proof")
    candidate, expected, expected_path = _prepared(bundle, folder, record["baseFile"], required_points, author_contract)
    if expected_path.resolve() != proof_path.resolve() or record != expected or proof_path.read_bytes() != before:
        raise ValueError("Automatic text repair proof changed")
    evidence = {"file": proof_path.name, "sha256": hashlib.sha256(before).hexdigest(), **deepcopy(record)}
    return candidate, evidence


def existing_repair(bundle, folder, base_file, required_points, author_contract):
    """Reapply only the exact immutable proposal for this raw base, if present."""
    _, proof_path = _paths(folder, base_file)
    if not proof_path.exists():
        return None
    return _checked(bundle, folder, proof_path, required_points, author_contract)[0]


def repair(bundle, folder, base_file, required_points, author_contract, call, timeout):
    """Make one bounded Sol field proposal, then validate it; never review/accept.

    The caller must preserve prior cached full-repair requests and decide when
    this optional path is appropriate. Rejected proposals remain as raw evidence
    but do not create a proof or replace the failed candidate.
    """
    existing = existing_repair(bundle, folder, base_file, required_points, author_contract)
    if existing is not None:
        return existing
    request = _request(bundle, folder, base_file, required_points)
    proposal_path, _ = _paths(folder, base_file)
    call(proposal_path, **request, attachments=bundle["attachments"], timeout=timeout)
    candidate, record, proof_path = _prepared(bundle, folder, base_file, required_points, author_contract)
    if proof_path.exists():
        if _read(proof_path) != record:
            raise ValueError("Refusing to overwrite another automatic text repair proof")
    else:
        atomic_json(proof_path, record)
    return _checked(bundle, folder, proof_path, required_points, author_contract)[0]


def review_evidence(bundle, folder, lesson, required_points, author_contract):
    """Select by exact result hash; later different candidates cannot rewrite it."""
    candidate_sha = template.value_sha(lesson)
    paths = list(Path(folder).glob("automatic-field-repair-*.json"))
    if any(_PROOF.fullmatch(path.name) is None for path in paths):
        raise ValueError("Invalid automatic text repair proof filename")
    # Raw drafts/repairs have monotonically increasing assigned serials. Keep
    # the first exact proof even if a later draft produces an identical result;
    # adding that later proposal must not change an earlier review's evidence.
    for path in sorted(paths, key=lambda item: int(_PROOF.fullmatch(item.name)[1])):
        record = _read(path)
        if not isinstance(record, dict):
            raise ValueError("Invalid automatic text repair proof object")
        if record.get("candidateSha256") != candidate_sha:
            continue
        candidate, checked = _checked(bundle, folder, path, required_points, author_contract)
        if candidate != lesson:
            raise ValueError("Automatic repair is not the exact current review candidate")
        return [checked]
    return []

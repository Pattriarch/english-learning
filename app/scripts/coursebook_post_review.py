"""Exact editorial corrections after a rejected whole-chapter semantic review.

Source/review/transport receipts remain immutable. An editorial proposal is not
acceptance: the entire patched lesson must pass validation and a fresh Astra
review. This path does not run automatically alongside a live unit writer.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re

import coursebook_lesson_template as template
from coursebook_editorial_patch import apply_changes

KIND = "coursebook-post-review-editorial-v1"
KIND_WITH_MOVE = "coursebook-post-review-editorial-v2"
_PROPOSAL = re.compile(r"lesson-editorial-proposal-([1-6])\.json")
_PREVIOUS = re.compile(r"lesson-(?:review-([1-6])|editorial-review-([1-6]))\.json")
_FIELDS = {"version", "kind", "unitId", "sourceSetSha256", "sourceReview", "baseCandidateSha256", "changes"}
RENDERER_CONTRACT = {
    "version": 1,
    "userOutputPreference": "The user requires writing complete original English answers, not selecting obvious choices or filling a single obvious gap. Adapt a source constrained-completion task into complete learner-produced sentences with the same grammatical/category constraints; preserve the actual learning outcome, not necessarily the printed response format.",
    "sourceOutcome": "Cover each accepted source teaching point substantively. A source exercise format is reference data, not an instruction overriding the user's full-output preference. Supported practice and independent production have different evidential strength.",
    "materialPresentation": "Listening/dialogue transcripts and reference texts are collapsed by default. The learner may reveal them with an explicit button; there is no enforced lock until submission. Reading material stays visible. Listening materials include a saved pre-reveal notes draft. Describe voluntarily unrevealed first attempts and supported practice honestly, never claim technically enforced blindness or an independent score after viewing answers.",
    "originalAudio": "An original non-reference material with no authentic recording can be played by the actual local en-US Kokoro button. It synthesizes the entire material.text exactly as written. A dialogue/listening material starts with its transcript hidden. The synth does not automatically select among alternatives, conceal a displayed key, perform specified focus/silent-h phonetics, or prove native recorded realization. Separate spoken stimulus text from nonspoken directions/keys and avoid invented audio controls.",
    "approvedAudio": "Approved /book-recordings/*.mp3 materials have actual player controls and exact supplied transcripts. Source hashes prove identity and ASR/source alignment evidence has its stated limits; neither source images nor transcripts certify an acoustic observation.",
    "revision": "The runtime passes current-version prior production answers to revision feedback. Learners still submit their own Original/Revised blocks for deliberate comparison. Recording tasks let learners record, save, replay and record a revised attempt. Do not invent an audible defect when none is observed."
}


def _read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _base_request(candidate, author, bundle, folder):
    import generate_new_coursebooks as pipeline
    return pipeline.lesson_review_request(candidate, author, bundle, folder)


def prepare(bundle, folder, author, proposal_name, *, seen=()):
    """Reconstruct one exact proposal chain and fresh whole-review request."""
    import generate_new_coursebooks as pipeline
    folder = Path(folder)
    match = _PROPOSAL.fullmatch(proposal_name)
    if match is None or proposal_name in seen or len(seen) >= 6:
        raise ValueError("Invalid or cyclic post-review proposal path")
    path = folder / proposal_name
    if path.resolve().parent != folder.resolve() or not path.is_file():
        raise ValueError("Post-review proposal is outside its chapter")
    proposal = _read(path)
    version = proposal.get("version") if isinstance(proposal, dict) else None
    expected_fields = _FIELDS | {"workflowMove"} if version == 2 else _FIELDS
    if (not isinstance(proposal, dict) or set(proposal) != expected_fields
            or type(version) is not int or version not in (1, 2)
            or proposal["kind"] != (KIND_WITH_MOVE if version == 2 else KIND)
            or proposal["unitId"] != bundle["chapter"]["unitId"]
            or proposal["sourceSetSha256"] != bundle["sourceSetSha256"]):
        raise ValueError("Post-review proposal identity/source changed")
    pipeline.validate_bundle(bundle)
    if _read(folder / "source-bundle.json") != bundle:
        raise ValueError("Post-review stored source bundle changed")
    record = proposal["sourceReview"]
    previous_match = _PREVIOUS.fullmatch(record.get("file", "")) if isinstance(record, dict) else None
    if previous_match is None:
        raise ValueError("Post-review base must be an exact previous whole review")
    prior_path = folder / record["file"]
    committed = _read(prior_path.with_suffix(".request.json"))
    base = committed["payload"]["candidate"]
    if template.value_sha(base) != proposal["baseCandidateSha256"]:
        raise ValueError("Post-review exact base candidate changed")
    if previous_match[2]:
        previous_index = int(previous_match[2])
        if previous_index >= int(match[1]):
            raise ValueError("Editorial review chain must advance monotonically")
        previous = prepare(bundle, folder, author, f"lesson-editorial-proposal-{previous_index}.json", seen=(*seen, proposal_name))
        if previous["candidate"] != base:
            raise ValueError("Previous editorial candidate does not match its whole review")
        expected = previous["request"]
    else:
        expected = _base_request(base, author, bundle, folder)
    review = pipeline.verify_call(record, folder, {key: expected[key] for key in ("prompt", "payload", "schema")}, bundle["attachments"])
    if template.validate_review(review, base, author):
        raise ValueError("Post-review recovery must start from a rejected candidate, not rewrite an acceptance")
    candidate = apply_changes(base, bundle, proposal["changes"])
    if version == 2:
        from coursebook_workflow_move import apply_move
        candidate = apply_move(candidate, proposal["workflowMove"])
    template.validate_lesson(candidate, author)
    evidence = {"file": proposal_name, "sha256": _sha(path), "sourceReview": deepcopy(record),
                "baseCandidateSha256": template.value_sha(base), "candidateSha256": template.value_sha(candidate),
                "changes": [{"path": deepcopy(change["path"]), "reason": change["reason"]} for change in proposal["changes"]]}
    if version == 2:
        evidence["workflowMove"] = deepcopy(proposal["workflowMove"])
    request = _base_request(candidate, author, bundle, folder)
    request["payload"]["postReviewEditorial"] = evidence
    request["payload"]["applicationAndUserContract"] = deepcopy(RENDERER_CONTRACT)
    request["payload"]["previousRejectedFindings"] = deepcopy(review["findings"])
    request["prompt"] += "\nThe exact current candidate contains documented direct editorial proposals after a rejected whole review. These are authored by AI agents, not human verification or acceptance. Independently inspect the ENTIRE chapter and every source point, including unchanged fields, using the supplied factual application/user contract. Prior findings may be resolved; require real learning-outcome coverage, not literal reproduction of a source exercise format. Do not claim acoustic facts from text or enforce controls the application does not have.\n"
    request["sha256"] = template.value_sha({key: request[key] for key in ("prompt", "payload", "schema")})
    return {"candidate": candidate, "evidence": evidence, "request": request,
            "reviewFile": f"lesson-editorial-review-{int(match[1])}.json"}


def verify_receipt(receipt, bundle, folder, author):
    item = receipt.get("postReviewEditorial")
    if not isinstance(item, dict):
        raise ValueError("Post-review receipt lacks exact proposal evidence")
    prepared = prepare(bundle, folder, author, item.get("file", ""))
    if (item != prepared["evidence"] or receipt["lesson"] != prepared["candidate"]
            or receipt["lessonAcceptance"]["file"] != prepared["reviewFile"]):
        raise ValueError("Post-review receipt differs from its exact proposed and reviewed candidate")
    return prepared["request"]


def run(bundle, folder, proposal_name, timeout=1800):
    """Review an explicit offline proposal; all normal source/review gates remain."""
    import generate_new_coursebooks as pipeline
    folder = Path(folder)
    # A semantic recovery may run alongside other units, but never alongside
    # this chapter's active writer in the full coordinator.
    status_path = pipeline.WORK / "run-status.json"
    if status_path.exists():
        status = _read(status_path)
        expected_folder = pipeline.WORK / "units" / bundle["chapter"]["unitId"] / bundle["sourceSetSha256"]
        if folder.resolve() == expected_folder.resolve() and any(
                row.get("unitId") == bundle["chapter"]["unitId"] and row.get("status") in ("running", "queued")
                for row in status.get("chapters", [])):
            raise ValueError("Post-review recovery cannot overlap an active or queued unit writer")
    if (folder / "verified.json").exists():
        raise ValueError("Do not replace an existing accepted chapter")
    source_receipt = _read(folder / "analysis-verified.json")
    pipeline.verify_analysis_ready(source_receipt, bundle, folder)
    analysis = source_receipt["analysis"]
    author = pipeline.author_request(bundle, analysis, folder)
    prepared = prepare(bundle, folder, author, proposal_name)
    review_path = folder / prepared["reviewFile"]
    review = pipeline.cached_call(review_path, **{key: prepared["request"][key] for key in ("prompt", "payload", "schema")},
                                  attachments=bundle["attachments"], timeout=timeout)
    lesson = prepared["candidate"]
    if not template.validate_review(review, lesson, author):
        return {"status": "editorial-revise", "unitId": bundle["chapter"]["unitId"],
                "reviewFile": str(review_path), "findings": review["findings"]}
    receipt = {"version": pipeline.VERSION, "unitId": bundle["chapter"]["unitId"],
               "sourceSetSha256": bundle["sourceSetSha256"], "analysis": analysis,
               "analysisSha256": template.value_sha(analysis), "analysisAcceptance": source_receipt["analysisAcceptance"],
               "lesson": lesson, "lessonSha256": template.value_sha(lesson), "lessonAcceptance": pipeline.checkpoint_record(review_path),
               "identityNormalizations": [{"file": path.name, "sha256": pipeline.file_sha(path)}
                    for path in sorted(folder.glob("lesson-draft-*.identity-normalization.json"))],
               "postReviewEditorial": prepared["evidence"]}
    patched = pipeline.load_patch(bundle, folder)
    if patched is not None:
        receipt["editorialPatch"] = patched[1]
    field = pipeline.field_repair_evidence(bundle, folder)
    if field is not None:
        receipt["fieldRepairProposal"] = field
    recovery = pipeline.recovery_seed(bundle, folder)
    if recovery is not None:
        receipt["recoverySeed"] = recovery["evidence"]
    automatic = pipeline.automatic_repair_evidence(lesson, author, bundle, folder)
    if automatic:
        receipt["automaticFieldRepairs"] = automatic
    pipeline.verify_ready(receipt, bundle, folder)
    pipeline.atomic_json(folder / "lesson.json", lesson)
    pipeline.atomic_json(folder / "verified.json", receipt)
    return {"status": "verified", "unitId": bundle["chapter"]["unitId"], "file": str(folder / "verified.json")}


if __name__ == "__main__":
    import argparse
    import generate_new_coursebooks as pipeline
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--folder", type=Path, required=True)
    parser.add_argument("--proposal", required=True)
    parser.add_argument("--timeout", type=int, default=1800)
    options = parser.parse_args()
    if options.timeout < 30:
        parser.error("timeout must be at least 30 seconds")
    snapshot = _read(options.folder / "source-bundle.json")
    bundle = pipeline.current_bundle(snapshot)
    if bundle != snapshot:
        raise ValueError("Editorial recovery source is no longer current")
    print(json.dumps(run(bundle, options.folder, options.proposal, options.timeout), ensure_ascii=False), flush=True)

"""Reuse an unchanged chapter's structural analysis as an UNVERIFIED candidate.

This helper never imports the generator, calls a model, reuses a review decision,
or fabricates a model checkpoint. The caller must independently review any seed.
Obsolete source-file selectors are not reread: live source validation belongs to
the caller, while both stored bundle self-hashes and complete semantic data are
checked here.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path

from coursebook_lesson_template import value_sha


VERSION = "coursebook-unverified-analysis-seed-v1"
REASON = ("The complete semantic source bundle is unchanged; only source-file bookkeeping differs. "
          "This structurally checked analysis is an unverified candidate and requires a fresh independent review.")
RECORD_FIELDS = {"version", "status", "independentReviewRequired", "sourceBundleFile",
                 "sourceBundleFileSha256", "sourceAnalysisFile", "sourceAnalysisFileSha256",
                 "oldSourceSetSha256", "newSourceSetSha256", "semanticBundleSha256",
                 "candidate", "candidateSha256", "reason", "recordSha256"}


def _file_sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _read_artifact(path):
    raw = Path(path).read_bytes()
    return json.loads(raw.decode("utf-8-sig")), hashlib.sha256(raw).hexdigest()


def _semantic_bundle(bundle):
    if not isinstance(bundle, dict) or bundle.get("sourceSetSha256") != value_sha(
            {key: value for key, value in bundle.items() if key != "sourceSetSha256"}):
        raise ValueError("Analysis seed source bundle self-hash is invalid")
    # Nothing inside source/chapter/audio/attachments is ignored or normalized.
    return {key: value for key, value in bundle.items() if key not in {"sourceFiles", "sourceSetSha256"}}


def _paths(old_folder, folder):
    old_folder, folder = Path(old_folder).resolve(), Path(folder).resolve()
    if old_folder == folder or old_folder.parent != folder.parent:
        raise ValueError("Analysis seed source must be a different sibling source-set folder")
    bundle_path, analysis_path = old_folder / "source-bundle.json", old_folder / "analysis.json"
    if bundle_path.resolve().parent != old_folder or analysis_path.resolve().parent != old_folder:
        raise ValueError("Analysis seed artifact escapes its sibling source-set folder")
    return bundle_path, analysis_path


def _candidate(old_bundle, old_analysis, bundle, validate_analysis):
    if _semantic_bundle(old_bundle) != _semantic_bundle(bundle):
        raise ValueError("Analysis seed semantic source bundle differs")
    # A validator is not allowed to change the retained source candidate.
    validate_analysis(deepcopy(old_analysis), deepcopy(old_bundle))
    candidate = deepcopy(old_analysis)
    candidate["bundleSha256"] = bundle["sourceSetSha256"]
    return candidate


def _verify_record(record, bundle, folder, validate_analysis):
    if (not isinstance(record, dict) or set(record) != RECORD_FIELDS
            or record["version"] != VERSION or record["status"] != "unverified-analysis-seed"
            or record["independentReviewRequired"] is not True or record["reason"] != REASON
            or record["recordSha256"] != value_sha({key: value for key, value in record.items() if key != "recordSha256"})):
        raise ValueError("Immutable analysis seed record is invalid")
    semantic = _semantic_bundle(bundle)
    if (record["newSourceSetSha256"] != bundle["sourceSetSha256"]
            or record["semanticBundleSha256"] != value_sha(semantic)):
        raise ValueError("Analysis seed is bound to a different current source bundle")
    if not isinstance(record["sourceBundleFile"], str) or not isinstance(record["sourceAnalysisFile"], str):
        raise ValueError("Analysis seed source artifact paths are invalid")
    bundle_path, analysis_path = _paths(Path(record["sourceBundleFile"]).parent, folder)
    if (record["sourceBundleFile"] != str(bundle_path)
            or record["sourceAnalysisFile"] != str(analysis_path)):
        raise ValueError("Analysis seed source artifact paths changed")
    try:
        old_bundle, bundle_sha = _read_artifact(bundle_path)
        old_analysis, analysis_sha = _read_artifact(analysis_path)
    except (OSError, ValueError) as error:
        raise ValueError("Analysis seed source artifacts are unavailable or invalid") from error
    if (not isinstance(old_bundle, dict) or record["sourceBundleFileSha256"] != bundle_sha
            or record["sourceAnalysisFileSha256"] != analysis_sha
            or record["oldSourceSetSha256"] != old_bundle.get("sourceSetSha256")):
        raise ValueError("Analysis seed source artifact bytes changed")
    candidate = _candidate(old_bundle, old_analysis, bundle, validate_analysis)
    if record["candidate"] != candidate or record["candidateSha256"] != value_sha(candidate):
        raise ValueError("Analysis seed candidate differs from the exact rebased source analysis")
    return candidate


def load_seed(bundle, folder, validate_analysis):
    """Return an unverified rebased candidate, or None without negative caching.

    Existing model-draft requests take precedence. Otherwise an existing seed is
    immutable and must verify exactly; an invalid existing record raises rather
    than silently selecting a different candidate. Compatible sibling analyses
    are considered by descending analysis.json modification time.
    """
    _semantic_bundle(bundle)
    folder = Path(folder).resolve()
    if (folder / "analysis-draft-1.request.json").exists():
        return None
    record_path = folder / "analysis-seed.json"
    if record_path.exists():
        try:
            record, _ = _read_artifact(record_path)
        except (OSError, ValueError) as error:
            raise ValueError("Immutable analysis seed record is unreadable") from error
        return _verify_record(record, bundle, folder, validate_analysis)
    if not folder.parent.exists():
        return None
    candidates = []
    for sibling in folder.parent.iterdir():
        if not sibling.is_dir() or sibling.resolve() == folder:
            continue
        try:
            bundle_path, analysis_path = _paths(sibling, folder)
            if bundle_path.is_file() and analysis_path.is_file():
                candidates.append((analysis_path.stat().st_mtime_ns, str(sibling), bundle_path, analysis_path))
        except (OSError, ValueError):
            continue
    for _, _, bundle_path, analysis_path in sorted(candidates, reverse=True):
        try:
            old_bundle, bundle_sha = _read_artifact(bundle_path)
            old_analysis, analysis_sha = _read_artifact(analysis_path)
            candidate = _candidate(old_bundle, old_analysis, bundle, validate_analysis)
            if _file_sha(bundle_path) != bundle_sha or _file_sha(analysis_path) != analysis_sha:
                continue
        except (OSError, ValueError, TypeError, KeyError):
            continue
        record = {"version": VERSION, "status": "unverified-analysis-seed", "independentReviewRequired": True,
            "sourceBundleFile": str(bundle_path), "sourceBundleFileSha256": bundle_sha,
            "sourceAnalysisFile": str(analysis_path), "sourceAnalysisFileSha256": analysis_sha,
            "oldSourceSetSha256": old_bundle["sourceSetSha256"], "newSourceSetSha256": bundle["sourceSetSha256"],
            "semanticBundleSha256": value_sha(_semantic_bundle(bundle)), "candidate": candidate,
            "candidateSha256": value_sha(candidate), "reason": REASON}
        record["recordSha256"] = value_sha(record)
        folder.mkdir(parents=True, exist_ok=True)
        try:
            # Exclusive creation preserves immutability if two callers race.
            # A interrupted partial write fails closed on the next resume.
            with record_path.open("x", encoding="utf-8", newline="\n") as handle:
                handle.write(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
        except FileExistsError:
            existing, _ = _read_artifact(record_path)
            return _verify_record(existing, bundle, folder, validate_analysis)
        return deepcopy(candidate)
    return None

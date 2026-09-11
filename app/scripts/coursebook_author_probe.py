"""Isolated full-chapter Astra author pilot; never publishes or grants readiness.

The fixed pilot uses current GW1 unit5 source/accepted analysis, a fresh complete
author contract, at most two format repairs, and one separate whole review.
No previous Sol candidate or semantic findings are included in either call.
Run only in its own process, while the main coordinator excludes this unit.
"""
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
import threading

import coursebook_lesson_template as template
import generate_new_coursebooks as pipeline

UNIT = "great-writing-1-4-005"
MODEL = "gpt-6-astra"
REASONING_ARGUMENTS = ["-c", 'model_reasoning_effort="high"']


@contextmanager
def author_policy():
    if threading.active_count() != 1:
        raise ValueError("Author probe requires an isolated single-thread process")
    previous = pipeline.model_policy

    def probe_policy(schema):
        if "sections" in schema.get("properties", {}):
            return "lesson-author-probe", MODEL
        return previous(schema)

    pipeline.model_policy = probe_policy
    try:
        yield
    finally:
        pipeline.model_policy = previous


def prepare(origin, work, *, check_only=False):
    origin, work = Path(origin), Path(work)
    if pipeline.REASONING_ARGUMENTS != REASONING_ARGUMENTS:
        raise ValueError("Author probe requires the explicit high reasoning contract")
    snapshot = pipeline.read(origin / "source-bundle.json")
    bundle = pipeline.current_bundle(snapshot)
    if snapshot != bundle or bundle["chapter"]["unitId"] != UNIT:
        raise ValueError("Author probe requires the exact current single pilot chapter")
    folder = work / "units" / UNIT / bundle["sourceSetSha256"]
    if folder.resolve() == origin.resolve() or folder.resolve().is_relative_to(pipeline.WORK.resolve()):
        raise ValueError("Author probe cannot write into the normal chapter work tree")
    status_path = pipeline.WORK / "run-status.json"
    if status_path.exists() and any(row.get("unitId") == UNIT and row.get("status") in ("running", "queued")
            for row in pipeline.read(status_path).get("chapters", [])):
        raise ValueError("Author probe cannot overlap the main chapter writer")
    source_receipt = pipeline.read(origin / "analysis-verified.json")
    pipeline.verify_analysis_ready(source_receipt, bundle, origin)
    author = pipeline.author_request(bundle, source_receipt["analysis"])
    if author["prompt"] != template.APPLICATION_AUTHOR_PROMPT:
        raise ValueError("Author probe requires the full current application contract")
    policy = {"version": 1, "unitId": UNIT, "sourceSetSha256": bundle["sourceSetSha256"],
        "origin": str(origin.resolve()), "analysisReceiptSha256": pipeline.file_sha(origin / "analysis-verified.json"),
        "authorRole": "lesson-author-probe", "authorModel": MODEL,
        "reviewRole": "independent-review", "reviewModel": MODEL,
        "reasoningArguments": deepcopy(REASONING_ARGUMENTS),
        "authorRequestSha256": author["sha256"], "maxFormatRepairs": 2,
        "comparison": "Full independent semantic review; no earlier author's drafts or findings supplied"}
    path = folder / "author-probe-policy.json"
    if path.exists():
        if pipeline.read(path) != policy:
            raise ValueError("Author probe policy/source identity changed")
    elif check_only:
        raise ValueError("Author probe lacks a committed policy")
    else:
        pipeline.prepare_chapter_work(bundle, folder)
        pipeline.atomic_json(path, policy)
    if pipeline.read(folder / "source-bundle.json") != bundle:
        raise ValueError("Author probe source snapshot changed")
    return bundle, folder, author, policy


def run(origin, work, timeout=1800, *, check_only=False):
    bundle, folder, author, policy = prepare(origin, work, check_only=check_only)
    attachments = bundle["attachments"]
    calls = []

    def call(name, request):
        path = folder / name
        logical = {key: request[key] for key in ("prompt", "payload", "schema")}
        if check_only and (not path.exists() or not path.with_suffix(".request.json").exists()):
            raise ValueError("Author probe verification cannot dispatch a missing model call")
        value = pipeline.cached_call(path, **logical, attachments=attachments, timeout=timeout)
        if not path.with_suffix(".invocation.json").is_file():
            raise ValueError("Author probe requires actual model invocation provenance for every call")
        invocation = pipeline.read(path.with_suffix(".invocation.json"))
        if (type(invocation.get("version")) is not int or invocation["version"] != 2
                or invocation.get("reasoningArguments") != REASONING_ARGUMENTS):
            raise ValueError("Author probe requires version-2 invocation with exact explicit high reasoning")
        record = pipeline.checkpoint_record(path)
        if pipeline.verify_call(record, folder, logical, attachments) != value:
            raise ValueError("Author probe response differs from its actual invocation proof")
        calls.append(record)
        return value, path

    result = {"version": 1, "kind": "coursebook-author-comparison-probe-v1", "unitId": UNIT,
              "sourceSetSha256": bundle["sourceSetSha256"], "policySha256": template.value_sha(policy),
              "sourceAnalysisSha256": template.value_sha(author["payload"]["source"]["sourceAnalysis"]),
              "publicationReady": False}
    with author_policy():
        request = author
        for repair in range(3):
            name = "lesson-draft-1.json" if repair == 0 else f"lesson-draft-1-repair-{repair}.json"
            raw, path = call(name, request)
            if check_only and raw.get("id") != "book-" + UNIT and not path.with_suffix(".identity-normalization.json").exists():
                raise ValueError("Author probe lacks exact ID-normalization evidence")
            lesson = pipeline.normalize_lesson_identity(raw, bundle, path)
            try:
                template.validate_lesson(lesson, author)
                break
            except (ValueError, KeyError, TypeError) as error:
                findings = [str(error), *template.lesson_depth_findings(lesson)]
                if repair == 2:
                    result.update({"status": "structural-failure", "findings": findings, "authorCalls": calls})
                    break
                request = pipeline.revised_request(author, lesson, [*findings, template.AUTHOR_REQUIREMENTS])
        else:
            raise AssertionError("Bounded author loop did not finish")
        if "status" not in result:
            # No source/model comparison history goes to the independent reviewer.
            review_request = template.build_review_request(lesson, author)
            review, _ = call("lesson-review-1.json", review_request)
            accepted = template.validate_review(review, lesson, author)
            result.update({"status": "reviewed", "decision": "accept" if accepted else "revise",
                "candidateSha256": template.value_sha(lesson), "lesson": lesson,
                "findings": review["findings"], "authorCalls": calls[:-1], "reviewCall": calls[-1]})
    pipeline.validate_bundle(bundle)
    output = folder / "probe-result.json"
    if check_only:
        if pipeline.read(output) != result:
            raise ValueError("Author probe result differs from its reconstructed complete proof")
    else:
        pipeline.atomic_json(output, result)
    return result


if __name__ == "__main__":
    import argparse
    import json
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=1800)
    parser.add_argument("--check", action="store_true")
    options = parser.parse_args()
    if options.timeout < 30:
        parser.error("timeout must be at least 30 seconds")
    result = run(options.origin, options.work, options.timeout, check_only=options.check)
    print(json.dumps({key: value for key, value in result.items() if key != "lesson"}, ensure_ascii=False), flush=True)

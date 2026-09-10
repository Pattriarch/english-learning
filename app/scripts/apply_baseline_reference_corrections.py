"""Apply reviewed reference corrections after authoring stops; never call a model.

The authoring lock prevents racing the publisher's in-memory snapshot. Exact
before/after values allow safe recovery if a previous run stopped between the
atomic cache and course writes. Every conflict is checked before any write.
"""
from copy import deepcopy
import argparse
from pathlib import Path

from build_baseline_references import (APP, COURSES, VERSION, atomic_json,
    build_lock, digest, read, require, source_hash, stamp, validate_patch)


def apply_corrections(app, data=None, manifest_path=None, apply=False):
    data = data or app / "data"
    manifest_path = manifest_path or data / "baseline-reference-editorial-corrections.json"
    with build_lock(data / "baseline-reference-build.lock"):
        manifest = read(manifest_path)
        require(manifest.get("version") == 1, "Unsupported correction manifest")
        entries = manifest.get("corrections", [])
        require(len({e["lessonId"] for e in entries}) == len(entries), "Duplicate correction lesson")
        units = {u["lessonId"]: u for u in read(data / "baseline-reference-inventory.json")["units"]}
        courses, originals, writes = {}, {}, {}
        exercise_count = 0
        for entry in entries:
            identifier = entry["lessonId"]
            unit = units[identifier]
            require(unit["course"] in COURSES and entry["sourceHash"] == unit["sourceHash"], "Wrong correction source")
            course_path = app / "content/courses" / unit["course"]
            if course_path not in courses:
                originals[course_path] = course_path.read_bytes()
                courses[course_path] = read(course_path)
            matches = [l for l in courses[course_path] if l["id"] == identifier]
            require(len(matches) == 1, "Missing or duplicate current lesson")
            current = matches[0]
            require(source_hash(current, unit["targetIds"]) == unit["sourceHash"], "Source changed: " + identifier)
            cache_path = data / "baseline-reference-patches" / (identifier + ".json")
            originals[cache_path] = cache_path.read_bytes()
            cache = read(cache_path)
            require(cache.get("promptVersion") == VERSION and cache.get("sourceHash") == unit["sourceHash"], "Obsolete cache")
            require(cache.get("patchSHA256") == digest(cache["patch"]), "Cache checksum differs")
            validate_patch(cache["patch"], unit)
            before_patch, after_patch = deepcopy(cache["patch"]), deepcopy(cache["patch"])
            changes = entry["changes"]
            require(changes and len({c["exerciseId"] for c in changes}) == len(changes), "Empty or duplicate exercise correction")
            for change in changes:
                eid = change["exerciseId"]
                require(eid in unit["targetIds"] and change["before"]["id"] == eid and change["after"]["id"] == eid,
                        "Correction changes exercise identity")
                index = next(i for i, e in enumerate(cache["patch"]["exercises"]) if e["id"] == eid)
                require(cache["patch"]["exercises"][index] in (change["before"], change["after"]), "Concurrent cache edit")
                before_patch["exercises"][index] = deepcopy(change["before"])
                after_patch["exercises"][index] = deepcopy(change["after"])
                exercise = next(e for e in current["exercises"] if e["id"] == eid)
                actual_pair = {k: exercise.get(k) for k in ("answers", "explanation")}
                before_pair = {k: change["before"][k] for k in actual_pair}
                after_pair = {k: change["after"][k] for k in actual_pair}
                require(actual_pair in (before_pair, after_pair), "Concurrent published answer edit: " + identifier + "/" + eid)
                exercise.update(after_pair)
                exercise_count += 1
            require(digest(before_patch) == entry["beforePatchSHA256"], "Reviewed cache differs from original")
            validate_patch(after_patch, unit)
            cache["patch"] = after_patch
            cache["patchSHA256"] = digest(after_patch)
            record_hash = digest(entry)
            records = cache.setdefault("editorialCorrections", [])
            if not any(r.get("correctionSHA256") == record_hash for r in records):
                records.append({"at": stamp(), "correctionSHA256": record_hash,
                                "manifest": manifest_path.name, "entry": deepcopy(entry)})
            writes[cache_path] = cache
        writes.update(courses)
        changed = {path: value for path, value in writes.items() if read(path) != value}
        # Check every target again before beginning publication. The shared lock
        # protects authoring; this additionally catches an unrelated editor.
        require(all(path.read_bytes() == old for path, old in originals.items()), "Files changed during correction preflight")
        if apply:
            for path, value in changed.items():
                require(path.read_bytes() == originals[path], "File changed before correction write")
                atomic_json(path, value)
        return {"lessons": len(entries), "exercises": exercise_count, "changedFiles": len(changed), "applied": apply}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, default=APP)
    parser.add_argument("--data", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    import json
    print(json.dumps(apply_corrections(args.app, args.data, args.manifest, args.apply), ensure_ascii=False))


if __name__ == "__main__":
    main()

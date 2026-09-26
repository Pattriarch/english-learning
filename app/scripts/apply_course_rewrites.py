"""Apply rewritten guided lessons (docs/COURSE-STANDARD.md) to the course.

For every staged lesson file <stage>/<lesson-id>.json it:
- replaces the lesson in its course file at the same position;
- removes the lesson's course-guide overlay, the old second explanation layer;
- assigns revisions: an unchanged task keeps its identity, a changed or reused
  ID gets the next revision, a new ID starts at 1 (history is never rewritten);
- points skill-map evidence to the lesson's independent tasks and refreshes the
  snapshot hashes of changed files.
Real recordings, their transcripts and prepared figures must stay byte-identical.

  python app/scripts/apply_course_rewrites.py STAGE_DIR_OR_FILES... [--dry-run]
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from course_standard_lint import lint, route_order, known_lessons  # noqa: E402

APP = Path(__file__).resolve().parents[1]
REPO = APP.parent
CONTENT = APP / "content"
LESSON_KEYS = ["id", "title", "subtitle", "level", "group", "units", "minutes", "goal", "formula", "beginner", "guided",
               "introSections", "introExamples", "prerequisites", "recycles", "teaches", "sources", "visual", "sections",
               "examples", "materials", "exercises", "generated", "provenance"]
EXERCISE_KEYS = ["id", "revision", "kind", "practiceStage", "prompt", "context", "guidance", "hint", "answers",
                 "explanation", "materialIds"]
# `provenance` described how an old version was generated; a rewrite drops it.
PRESERVED = ["beginner", "generated"]


def read(path):
    raw = path.read_bytes()
    return json.loads(raw.decode("utf-8-sig")), ("\r\n" if b"\r\n" in raw else "\n")


def write(path, data, newline):
    path.write_bytes((json.dumps(data, ensure_ascii=False, indent=2) + "\n").replace("\n", newline).encode("utf-8"))


def ordered(obj, keys):
    out = {k: obj[k] for k in keys if k in obj}
    out.update({k: v for k, v in obj.items() if k not in out})
    return out


def effective(lesson, guide):
    """The exercises a learner sees now, exactly as the server merges them."""
    if not guide:
        return list(lesson.get("exercises", []))
    replaced = {e["id"]: e for e in guide.get("replacements", [])}
    practice = [dict(e, revision=e.get("revision") or 1) for e in guide.get("practice", [])]
    return practice + [replaced.get(e["id"], e) for e in lesson.get("exercises", [])]


def signature(exercise, materials):
    """Everything that defines the question and its assessment."""
    fields = {k: exercise.get(k) for k in ("kind", "practiceStage", "prompt", "context", "answers", "explanation", "guidance")}
    fields["materials"] = [materials.get(m) for m in exercise.get("materialIds", []) or []]
    return json.dumps(fields, ensure_ascii=False, sort_keys=True)


def material_map(lesson):
    return {m["id"]: json.dumps(m, ensure_ascii=False, sort_keys=True) for m in lesson.get("materials", []) or []}


def pick_evidence(indicator, exercises, materials):
    independent = [e for e in exercises if e.get("practiceStage") == "independent"]
    kinds = {m["id"]: m.get("kind") for m in materials}
    domain = indicator.get("domain", "")
    def uses(e, wanted):
        return any(kinds.get(m) in wanted for m in e.get("materialIds", []) or [])
    choice = {
        "speaking": [e for e in independent if e["kind"] == "speak"],
        "writing": [e for e in independent if e["kind"] == "write"],
        "listening": [e for e in exercises if e.get("practiceStage") == "independent" and uses(e, {"listening", "dialogue"})]
                     or [e for e in exercises if uses(e, {"listening", "dialogue"}) and not e.get("guidance")],
        "reading": [e for e in exercises if uses(e, {"reading", "reference"}) and not e.get("guidance")],
    }.get(domain) or independent
    return choice


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true", help="apply despite lint errors (never for release)")
    args = parser.parse_args(argv)

    staged = []
    for p in args.paths:
        for f in (sorted(p.glob("*.json")) if p.is_dir() else [p]):
            staged.append(json.loads(f.read_text(encoding="utf-8-sig")))
    order, known = route_order(), known_lessons()
    for lesson in staged:
        known.setdefault(lesson.get("id"), lesson)
    bad = 0
    for lesson in staged:
        errors, _ = lint(lesson, order, known)
        if errors:
            bad += 1
            print(f"{lesson.get('id')}: {len(errors)} lint errors, first: {errors[0]}")
    if bad and not args.force:
        print("Refusing to apply lessons with lint errors.")
        return 1

    course_files = {p: read(p) for p in [CONTENT / "curriculum.json", *sorted((CONTENT / "courses").glob("*.json"))]}
    guide_files = {p: read(p) for p in sorted(CONTENT.glob("course-guides-*.json"))}
    map_path = CONTENT / "curriculum-mastery-map.json"
    mastery, map_newline = read(map_path)
    changed_files, report = set(), []

    for new in staged:
        lid = new["id"]
        home = next((p for p, (lessons, _) in course_files.items() if any(l["id"] == lid for l in lessons)), None)
        if home is None:
            # A new core lesson joins the foundation file after its route predecessor.
            if not lid.startswith("path-") or lid not in order:
                print(f"{lid}: not found in course files and not a new route lesson")
                return 1
            home = CONTENT / "courses" / "foundation.json"
            lessons = course_files[home][0]
            before = [x for x in order[:order.index(lid)] if any(l["id"] == x for l in lessons)]
            at = next(i for i, l in enumerate(lessons) if l["id"] == before[-1]) + 1 if before else len(lessons)
            lessons.insert(at, {"id": lid, "exercises": []})
        lessons = course_files[home][0]
        index = next(i for i, l in enumerate(lessons) if l["id"] == lid)
        old = lessons[index]
        guide, guide_home = None, None
        for p, (data, _) in guide_files.items():
            for g in data["lessons"]:
                if g["lessonId"] == lid:
                    guide, guide_home = g, p
        # Recordings, transcripts and prepared figures are evidence, not prose.
        new_materials = {m["id"]: m for m in new.get("materials", []) or []}
        for m in old.get("materials", []) or []:
            protected = m.get("audioFile") or m.get("sourceUrl") or m.get("inputSkill") or m.get("figure")
            if protected and json.dumps(new_materials.get(m["id"]), sort_keys=True) != json.dumps(m, sort_keys=True):
                print(f"{lid}: protected material {m['id']} (recording/source/figure) must stay unchanged")
                return 1
        previous = {e["id"]: e for e in effective(old, guide)}
        highest = {}
        for e in list(old.get("exercises", [])) + list((guide or {}).get("practice", [])) + list((guide or {}).get("replacements", [])):
            highest[e["id"]] = max(highest.get(e["id"], 0), e.get("revision") or 0)
        old_materials, fresh_materials = material_map(old), material_map(new)
        kept = bumped = created = 0
        exercises = []
        for e in new["exercises"]:
            e = dict(e)
            e.pop("revision", None)
            prior = previous.get(e["id"])
            if prior is not None and signature(prior, old_materials) == signature(e, fresh_materials):
                if prior.get("revision"):
                    e["revision"] = prior["revision"]
                kept += 1
            elif e["id"] in highest:
                e["revision"] = highest[e["id"]] + 1
                bumped += 1
            else:
                e["revision"] = 1
                created += 1
            if not e.get("context"):
                e["context"] = ""
            exercises.append(ordered(e, EXERCISE_KEYS))
        lesson = dict(new, exercises=exercises)
        for key in PRESERVED:
            if key in old and key not in lesson:
                lesson[key] = old[key]
        lessons[index] = ordered(lesson, LESSON_KEYS)
        changed_files.add(home)
        if guide is not None:
            guide_files[guide_home][0]["lessons"] = [g for g in guide_files[guide_home][0]["lessons"] if g["lessonId"] != lid]
            changed_files.add(guide_home)
        # Skill evidence follows the new independent work of this lesson.
        for level in mastery["levels"]:
            for indicator in level["indicators"]:
                seen, kept_rows = set(), []
                for row in indicator["evidence"]:
                    if row.get("lessonId") == lid:
                        chosen = pick_evidence(indicator, exercises, lesson.get("materials", []) or [])
                        row["exerciseIds"] = [e["id"] for e in chosen]
                        row["note"] = "Самостоятельно: " + " / ".join(e["prompt"][:110].rstrip() for e in chosen)
                        key = tuple(row["exerciseIds"])
                        if key in seen:
                            continue
                        seen.add(key)
                    kept_rows.append(row)
                indicator["evidence"] = kept_rows
        report.append(f"{lid}: {len(exercises)} tasks (kept {kept}, new revision {bumped}, new {created})"
                      + (f"; removed overlay from {guide_home.name}" if guide is not None else ""))

    if args.dry_run:
        print("\n".join(report))
        print("dry run: nothing written")
        return 0
    for p in changed_files:
        data, newline = course_files.get(p) or guide_files.get(p)
        write(p, data, newline)
    for snapshot in mastery.get("snapshotFiles", []):
        path = REPO / snapshot["file"]
        if path.exists():
            snapshot["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    write(map_path, mastery, map_newline)
    print("\n".join(report))
    print(f"applied {len(staged)} lessons; files: " + ", ".join(sorted(p.name for p in changed_files)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

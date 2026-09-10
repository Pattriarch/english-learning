"""Read-only integrity gate for curriculum references; never a CEFR certification."""
import argparse
import hashlib
import json
from pathlib import Path
import re


ID = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")
LEVELS = {"A1", "A2", "B1", "B2", "C1", "C2"}


def validate(content, repo_root):
    content, repo_root = Path(content).resolve(), Path(repo_root).resolve()
    errors = []
    counts = dict(lessons=0, indicators=0, evidence=0, exercises=0,
                  pathLessons=0, snapshots=0)

    def location(path):
        try:
            return str(Path(path).relative_to(repo_root)).replace("\\", "/")
        except ValueError:
            return str(path)

    def error(code, path, detail):
        errors.append(dict(code=code, path=location(path), detail=str(detail)))

    def load(path, default):
        try:
            return json.loads(Path(path).read_text(encoding="utf-8-sig"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            error("unreadable_json", path, exc)
            return default

    def rows(value, path, field):
        if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
            error("invalid_structure", path, field + " must be an array of objects")
            return []
        return value

    def field(value, name, path):
        if not isinstance(value, dict):
            error("invalid_structure", path, "expected an object")
            return []
        return rows(value.get(name), path, name)

    def indexed(value, path, name="id"):
        result = {}
        for row in rows(value, path, name):
            identifier = row.get(name)
            if not isinstance(identifier, str) or not ID.fullmatch(identifier):
                error("invalid_id", path, identifier)
            elif identifier in result:
                error("duplicate_id", path, identifier)
            else:
                result[identifier] = row
        return result

    # Mirror Server.loadContent: obsolete content/lessons files are not routes.
    lessons, lesson_files = {}, {}
    for path in [content / "curriculum.json", *sorted((content / "courses").glob("*.json"))]:
        for identifier, lesson in indexed(load(path, []), path).items():
            if identifier in lessons:
                error("duplicate_lesson", path, identifier)
            lessons[identifier] = set(indexed(lesson.get("exercises"), path))
            lesson_files[identifier] = path
    counts["lessons"] = len(lessons)

    project_file, pron_file = content / "projects-checkpoints.json", content / "pronunciation.json"
    projects = indexed(field(load(project_file, {}), "units", project_file), project_file)
    project_tasks = {identifier: set(indexed(unit.get("tasks"), project_file)) | {"revision", "transfer"}
                     for identifier, unit in projects.items()}
    pronunciation = indexed(field(load(pron_file, {}), "lessons", pron_file), pron_file)
    library_file = content / "library.json"
    book_units = {}
    for book in field(load(library_file, {}), "books", library_file):
        for identifier, unit in indexed(book.get("units"), library_file).items():
            if identifier in book_units:
                error("duplicate_book_unit", library_file, identifier)
            book_units[identifier] = unit
    research_file = content / "research-topics.json"
    research = indexed(field(load(research_file, {}), "topics", research_file), research_file) if research_file.exists() else {}

    map_file = content / "curriculum-mastery-map.json"
    catalog = load(map_file, {})
    levels = indexed(field(catalog, "levels", map_file), map_file, "level")
    if not levels:
        error("empty_map", map_file, "no levels to validate")
    if isinstance(catalog, dict) and "sources" in catalog:
        indexed(catalog["sources"], map_file)
    indicator_ids = set()
    for level, definition in levels.items():
        if level not in LEVELS:
            error("invalid_level", map_file, level)
        for identifier, indicator in indexed(definition.get("indicators"), map_file).items():
            counts["indicators"] += 1
            if identifier in indicator_ids:
                error("duplicate_indicator", map_file, identifier)
            indicator_ids.add(identifier)
            seen = set()
            for evidence in field(indicator, "evidence", map_file):
                counts["evidence"] += 1
                lesson_id, unit_id = evidence.get("lessonId"), evidence.get("unitId")
                exercises = evidence.get("exerciseIds")
                if not isinstance(lesson_id, str) or not ID.fullmatch(lesson_id) or (unit_id is not None and (not isinstance(unit_id, str) or not ID.fullmatch(unit_id))):
                    error("invalid_evidence_id", map_file, identifier + ": invalid lessonId/unitId")
                    continue
                if not isinstance(exercises, list) or any(not isinstance(e, str) for e in exercises):
                    error("invalid_structure", map_file, identifier + ": exerciseIds must be an array of IDs")
                    continue
                identity = (lesson_id, unit_id, tuple(exercises))
                if identity in seen or len(exercises) != len(set(exercises)):
                    error("duplicate_evidence", map_file, identifier + ": " + str(identity))
                seen.add(identity)
                available, source = None, None
                if unit_id or isinstance(lesson_id, str) and lesson_id.startswith("book-"):
                    unit_id = unit_id or lesson_id[5:]
                    if not isinstance(unit_id, str) or not ID.fullmatch(unit_id) or unit_id not in book_units:
                        error("missing_book_unit", map_file, identifier + ": " + str(unit_id))
                        continue
                    if lesson_id != "book-" + unit_id:
                        error("book_identity_mismatch", map_file, identifier + ": " + str(lesson_id))
                    source = content / "book-lessons" / (unit_id + ".json")
                    book = load(source, {})
                    if not isinstance(book, dict) or book.get("id") != "book-" + unit_id:
                        error("book_identity_mismatch", source, unit_id)
                    available = set(indexed(book.get("exercises") if isinstance(book, dict) else [], source))
                elif isinstance(lesson_id, str) and lesson_id.startswith("project-"):
                    available, source = project_tasks.get(lesson_id[8:]), project_file
                elif isinstance(lesson_id, str) and lesson_id.startswith("pron-"):
                    available = {lesson_id} if lesson_id in pronunciation else None
                    source = pron_file
                elif lesson_id == "pronunciation":
                    available, source = set(pronunciation), pron_file
                elif lesson_id == "research":
                    available, source = set(research), research_file
                elif isinstance(lesson_id, str):
                    available, source = lessons.get(lesson_id), lesson_files.get(lesson_id)
                if available is None:
                    error("missing_lesson", map_file, identifier + ": " + str(lesson_id))
                    continue
                for exercise in exercises:
                    counts["exercises"] += 1
                    if exercise not in available:
                        error("missing_exercise", map_file, identifier + ": " + str(lesson_id) + "/" + exercise)
                if evidence.get("file"):
                    if not isinstance(evidence["file"], str) or (repo_root / evidence["file"]).resolve() != source.resolve():
                        error("evidence_file_mismatch", map_file, identifier + ": " + str(evidence["file"]))

    route_file = content / "learning-path.json"
    route = load(route_file, {})
    for level in field(route, "levels", route_file):
        ids = level.get("lessonIds")
        if not isinstance(ids, list):
            error("invalid_structure", route_file, "lessonIds must be an array")
            continue
        for identifier in ids:
            counts["pathLessons"] += 1
            if not isinstance(identifier, str) or identifier not in lessons:
                error("missing_path_lesson", route_file, str(level.get("id")) + ": " + str(identifier))

    paths = set()
    for snapshot in field(catalog, "snapshotFiles", map_file):
        counts["snapshots"] += 1
        name, expected = snapshot.get("file"), snapshot.get("sha256")
        if not isinstance(name, str) or not isinstance(expected, str) or not SHA256.fullmatch(expected):
            error("invalid_snapshot", map_file, str(name))
            continue
        path = (repo_root / name).resolve()
        if Path(name).is_absolute() or not path.is_relative_to(repo_root):
            error("invalid_snapshot_path", map_file, name)
            continue
        if path in paths:
            error("duplicate_snapshot", map_file, name)
        paths.add(path)
        try:
            actual = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError as exc:
            error("missing_snapshot_file", path, exc)
            continue
        if actual != expected:
            error("stale_snapshot", path, "stored SHA256 differs from current file")

    return dict(ok=not errors, checks=counts, errorCount=len(errors), errors=errors[:25],
                omittedErrors=max(0, len(errors) - 25),
                scope="Reference and snapshot integrity only; not exhaustive CEFR coverage or learner certification.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--content", type=Path, default=Path(__file__).resolve().parents[1] / "content")
    parser.add_argument("--repo-root", type=Path, help="Base for snapshotFiles paths; defaults to the parent of app")
    args = parser.parse_args(argv)
    result = validate(args.content, args.repo_root or args.content.resolve().parent.parent)
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

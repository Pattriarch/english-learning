"""Refresh file-backed availability in the editorial crosswalk; never generate lessons.

Run from any directory: python app/scripts/refresh_external_book_crosswalk.py
Only external-book-crosswalk.json is written. Mapping judgments remain unchanged.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

from build_extended_course import validate as validate_extended, digest as extended_spec_hash, VERSION as EXTENDED_VERSION
from build_book_lessons import validate_lesson
from publish_book_release import atomic_json, catalog_units, validate_unit

APP = Path(__file__).resolve().parents[1]
CONTENT = APP / "content"


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def object_hash(value):
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def lesson_evidence(lesson):
    if not isinstance(lesson.get("sections"), list) or len(lesson["sections"]) < 3:
        raise ValueError("No substantial prepared theory")
    if not all(s.get("title") and s.get("body") for s in lesson["sections"]):
        raise ValueError("Empty theory section")
    exercises = lesson.get("exercises", [])
    if len(exercises) < 6 or not all(e.get("prompt") and e.get("explanation") and
                                   (e.get("answers") or e.get("kind") in ("write", "speak"))
                                   for e in exercises):
        raise ValueError("No complete prepared exercise set")
    return {
        "sectionTitles": [s["title"] for s in lesson["sections"]],
        "exerciseCount": len(exercises),
        "exercisesWithoutReference": [e["id"] for e in exercises if not e.get("answers")],
        "materialKinds": dict(Counter(m["kind"] for m in lesson.get("materials", []))),
        "lessonObjectSHA256": object_hash(lesson),
    }


def refresh():
    path = CONTENT / "external-book-crosswalk.json"
    crosswalk = read(path)
    catalog = catalog_units(CONTENT / "library.json")
    unit_meta = {u["id"]: (b, u) for b in read(CONTENT / "library.json")["books"]
                 if not b.get("duplicateOf") for u in b["units"]}
    plan = read(CONTENT / "extended-course-plan.json")
    modules = {m["id"]: m for m in plan["modules"]}
    courses = {}
    # content/lessons is an older, unrelated scene schema; none of its IDs are
    # used by this Studio crosswalk.
    course_paths = [CONTENT / "curriculum.json", *sorted((CONTENT / "courses").glob("*.json"))]
    for file in course_paths:
        value = read(file)
        for lesson in value if isinstance(value, list) else [value]:
            if lesson.get("id") in courses:
                raise ValueError("Duplicate local lesson ID: " + lesson["id"])
            courses[lesson["id"]] = (file, lesson)
    release = read(CONTENT / "book-release.json").get("units", {})
    for target in crosswalk["targets"].values():
        identifier = target["id"]
        for key in ("evidence", "validationError", "fileSHA256", "portableRelease", "validationBasis"):
            target.pop(key, None)
        if target["kind"] == "book-unit":
            if identifier not in catalog:
                raise ValueError("Unknown canonical book unit: " + identifier)
            book, unit = unit_meta[identifier]
            file = CONTENT / "book-lessons" / (identifier + ".json")
            target.update(bookId=book["id"], unitId=identifier, lessonId="book-" + identifier,
                          level=book["level"], pages=[unit["page"], unit["endPage"]],
                          path=file.relative_to(APP).as_posix(),
                          availability="catalog-only")
            if not file.exists():
                continue
            try:
                lesson = read(file)
                private_source = APP / "data" / "parsed-books" / (identifier + ".json")
                if private_source.exists():
                    result = validate_unit(identifier, catalog[identifier], file,
                                           APP / "data" / "parsed-books", APP / "data" / "book-page-images")
                    target["validationBasis"] = "local-source-and-page-hashes"
                    digest = result["lessonSHA256"]
                else:
                    digest = hashlib.sha256(file.read_bytes()).hexdigest()
                    if release.get(identifier, {}).get("lessonSHA256") != digest:
                        raise ValueError("No private source or matching portable release")
                    validate_lesson(lesson, catalog[identifier]["pages"] if lesson.get("provenance", {}).get("visualSourceUsed") else None)
                    target["validationBasis"] = "portable-release-hash"
                target.update(evidence=lesson_evidence(lesson), fileSHA256=digest,
                              portableRelease=release.get(identifier, {}).get("lessonSHA256") == digest,
                              availability="available")
            except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
                target.update(availability="unavailable", validationError=str(error))
        else:
            if target["kind"] == "extended":
                if identifier not in modules:
                    raise ValueError("Unknown extended plan module: " + identifier)
                target.update(level=modules[identifier]["level"], lessonId=identifier,
                              path="content/courses/extended-skills.json", availability="catalog-only")
            elif identifier not in courses:
                raise ValueError("Unknown prepared lesson: " + identifier)
            if identifier not in courses:
                continue
            file, lesson = courses[identifier]
            try:
                if target["kind"] == "extended":
                    validate_extended(lesson, modules[identifier])
                    provenance = lesson.get("provenance", {})
                    if provenance.get("specHash") != extended_spec_hash(modules[identifier]) or provenance.get("promptVersion") != EXTENDED_VERSION:
                        raise ValueError("Prepared extended lesson belongs to a different specification/version")
                target.update(lessonId=identifier, level=lesson["level"],
                              path=file.relative_to(APP).as_posix(), evidence=lesson_evidence(lesson),
                              availability="available", validationBasis="prepared-theory-and-exercises")
            except (ValueError, TypeError, KeyError, AttributeError) as error:
                target.update(availability="unavailable", validationError=str(error))
    expected = [str(n) + suffix for n in range(1, 11) for suffix in "AB"]
    if [b["id"] for b in crosswalk["blocks"]] != expected:
        raise ValueError("Crosswalk must contain exactly 1A–10B in order")
    for block in crosswalk["blocks"]:
        for match in block["language"] + block["practice"]:
            if not all(i in crosswalk["targets"] for i in match["targetIds"]):
                raise ValueError("Unresolved target in " + block["id"])
    crosswalk["availabilityCheckedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    crosswalk["availabilitySummary"] = dict(Counter(t["availability"] for t in crosswalk["targets"].values()))
    crosswalk["extendedPlanSHA256"] = hashlib.sha256((CONTENT / "extended-course-plan.json").read_bytes()).hexdigest()
    for target in crosswalk["targets"].values():
        review = target.get("editorialReview")
        if review and review.get("hashBasis") == "build_extended_course.digest":
            current = courses.get(target["id"])
            review["currentLessonMatches"] = bool(current and target["availability"] == "available" and
                extended_spec_hash(current[1]) == review.get("releaseLessonSHA256"))
    if crosswalk.get("bridgePlan"):
        crosswalk["bridgePlan"]["note"] = (
            "Адресные модули включены в активный план расширений. Готовность указана для каждого модуля "
            "после проверки опубликованного файла и его спецификации; это не заменяет редакторскую оценку полноты темы.")
        for module in crosswalk["bridgePlan"]["modules"]:
            module["availability"] = crosswalk["targets"].get(module["id"], {}).get("availability", "catalog-only")
        crosswalk["bridgePlan"]["availabilitySummary"] = dict(Counter(m["availability"] for m in crosswalk["bridgePlan"]["modules"]))
    if crosswalk.get("visualDataSupplement"):
        supplement = crosswalk["visualDataSupplement"]
        supplement["availability"] = crosswalk["targets"].get(supplement["moduleId"], {}).get("availability", "catalog-only")
    for block in crosswalk["blocks"]:
        if block["id"] == "1A":
            for practice in block["practice"]:
                if practice["skill"] == "listening" and "extended-c2-interview" in practice["targetIds"]:
                    practice["note"] = (
                        "Авторский материал тренирует детали, оговорки и изменение позиции в интервью. "
                        "Текущая готовность указана у связанного модуля; синтезированная озвучка учебного сценария "
                        "не заменяет подлинное многоакцентное интервью издателя.")
    remaining = crosswalk.get("remainingPracticeAudit", {})
    if remaining.get("queuedBookUnits"):
        remaining["queuedBookUnitsNote"] = (
            "Первоначальная очередь, зафиксированная при тематической проверке. "
            "Актуальная готовность этих глав приведена отдельно; сам список не означает, что они ещё ожидают подготовки.")
        remaining["queuedBookUnitAvailability"] = {
            identifier: "available" if identifier in release else "catalog-only"
            for identifier in remaining["queuedBookUnits"]
        }
    atomic_json(path, crosswalk)
    return crosswalk["availabilitySummary"]


if __name__ == "__main__":
    print(json.dumps(refresh(), ensure_ascii=False))

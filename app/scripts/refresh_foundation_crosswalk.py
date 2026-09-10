"""Validate local lesson evidence separately from editorial thematic matches."""
from __future__ import annotations
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

from build_book_lessons import validate_lesson
from build_extended_course import validate as validate_extended, digest as spec_hash, VERSION
from publish_book_release import atomic_json, catalog_units, validate_unit

APP = Path(__file__).resolve().parents[1]
CONTENT = APP / "content"


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode("utf-8")).hexdigest()


def validate_rows(sources):
    expected = {
        "ef-a1": [f"{i}{c}" for i in range(1, 13) for c in "AB"] + [f"PE{i}" for i in range(1, 7)],
        "ef-b1": [f"{i}{c}" for i in range(1, 11) for c in "AB"] + [f"PE{i}" for i in range(1, 6)],
        "speakout-a2": [f"{i}{c}" for i in range(1, 9) for c in "ABCD"],
        "speakout-b2": [f"{i}{c}" for i in range(1, 9) for c in "ABCD"],
    }
    if {s["id"] for s in sources} != set(expected) or len(sources) != len(expected):
        raise ValueError("The crosswalk must include exactly the four reviewed sources")
    targets = set()
    for source in sources:
        source_file = APP / "data/external-toc/foundation" / (source["id"] + ".pdf")
        if source_file.exists() and hashlib.sha256(source_file.read_bytes()).hexdigest() != source["sha256"]:
            raise ValueError("Reviewed source PDF changed: " + source["id"])
        if [r["code"] for r in source["rows"]] != expected[source["id"]]:
            raise ValueError("Incomplete or duplicated source rows: " + source["id"])
        for row in source["rows"]:
            if not row["label"] or not row["dimensions"]:
                raise ValueError("Empty row")
            kinds = []
            for dimension in row["dimensions"]:
                kinds.append(dimension["kind"])
                if dimension["kind"] not in ("grammar", "vocabulary", "pronunciation", "skills"):
                    raise ValueError("Unknown dimension")
                if dimension["coverage"] not in ("mapped", "partial", "skill-transfer", "gap"):
                    raise ValueError("Unknown editorial coverage judgment")
                if not dimension["targets"] and dimension["coverage"] != "gap":
                    raise ValueError("A positive mapping requires actual lesson IDs")
                if len(dimension["targets"]) != len(set(dimension["targets"])):
                    raise ValueError("Duplicate target in one dimension")
                targets.update(dimension["targets"])
            if len(set(kinds)) != len(kinds):
                raise ValueError("Duplicate dimension in " + row["code"])
            if not row["code"].startswith("PE"):
                required = {"grammar", "vocabulary"}
                if source["id"] != "ef-a1":
                    required.add("skills")
                speakout_d = source["id"].startswith("speakout-") and row["code"].endswith("D")
                if not speakout_d:
                    required.add("pronunciation")
                if source["id"] == "speakout-b2" and speakout_d:
                    language_kind = "grammar" if int(row["code"][:-1]) % 2 else "vocabulary"
                    required = {language_kind, "skills"}
                if not required <= set(kinds):
                    raise ValueError("An advertised column is missing in " + source["id"] + " " + row["code"])
                if source["id"] == "speakout-b2" and speakout_d and set(kinds) != required:
                    raise ValueError("An unadvertised column was added in " + source["id"] + " " + row["code"])
    return sorted(targets)


def course_evidence(lesson):
    sections = lesson.get("sections", [])
    exercises = lesson.get("exercises", [])
    if len(sections) < 3 or not all(s.get("title") and s.get("body") for s in sections):
        raise ValueError("Missing prepared theory")
    if not exercises or not all(e.get("id") and e.get("prompt") and e.get("explanation") for e in exercises):
        raise ValueError("Missing exercises or explanations")
    if len({e["id"] for e in exercises}) != len(exercises):
        raise ValueError("Duplicate exercise ID")
    missing = [e["id"] for e in exercises if not isinstance(e.get("answers"), list)
               or not e["answers"] or not all(isinstance(a, str) and a.strip() for a in e["answers"])]
    return dict(sectionTitles=[s["title"] for s in sections], exerciseCount=len(exercises),
                referencesPending=missing, lessonObjectSHA256=digest(lesson),
                materialKinds=dict(Counter(m["kind"] for m in lesson.get("materials", []))))


def write_report(crosswalk):
    pages = sum(source["pages"] for source in crosswalk["sources"])
    rows = sum(len(source["rows"]) for source in crosswalk["sources"])
    lines = ["# Дополнительная сверка A1–B2", "",
             f"Проверено страниц публичных оглавлений: {pages}; источников: {len(crosswalk['sources'])}. Карта содержит {rows} учебных блоков и практических разделов; короткие русские метки созданы для навигации. Полные тексты, упражнения, аудио и видео издателей не воспроизводятся.", "",
             "| Источник | Страницы | Блоки | Готовые опоры | Ещё готовятся |", "|---|---:|---:|---:|---:|"]
    for source in crosswalk["sources"]:
        counts = source["availabilitySummary"]
        waiting = sum(v for k, v in counts.items() if k != "available")
        lines.append(f"| [{source['title']}]({source['url']}) | {source['pages']} | {len(source['rows'])} | {counts.get('available', 0)} | {waiting} |")
    lines += ["", "Опоры считаются внутри каждого источника: один урок может встречаться в нескольких книгах. Это не число уникальных уроков приложения. Проверка файлов: " + crosswalk["availabilityCheckedAt"] + ".", "",
              "`content/foundation-book-crosswalk.json` содержит каждую строку: отдельные связи для грамматики, лексики, произношения и речевых навыков, точные ID, пояснения и свидетельства из существующих файлов. `mapped` означает прямую тематическую опору, `partial` — частичную, `skill-transfer` — похожую работу на другом исходном материале. Эти редакторские оценки не подменяются счётчиком готовности.", "",
              "## Что изменилось после проверки", "",
              "- В урок чтения IPA добавлен /ʊə/, варианты tour и cure и самостоятельное сравнение UK/US произношения. Подробности и словарные источники — в [PRONUNCIATION.md](PRONUNCIATION.md).",
              "- Подготовлена общая проверяемая сцена для описания действий и положения людей; она заменяет необходимость воображать или искать изображение.",
              "- Зафиксированы шесть ответов опроса и позднее исправление одного участника, чтобы отрабатывать свои вопросы, подсчёт, письменный и устный итог. Спецификации и границы — в [A2-EVIDENCE-BRIDGES.md](A2-EVIDENCE-BRIDGES.md).", ""]
    if any(d.get("updatedAt") for s in crosswalk["sources"] for r in s["rows"] for d in r["dimensions"]):
        lines += ["- После сверки B1 дополнены уроки 06/11/12: слабое have, the, чтение o/or, u, c, ai/air и различие used/used to. Есть свои фразы, объяснения выбора и запись. Прежние оценки сохранены в previousReview; полный внешний Sound Bank и весь набор чтений буквы s не объявлены покрытыми.", ""]
    for identifier in ("extended-a2-picture-description", "extended-a2-survey-summary"):
        target = crosswalk["targets"].get(identifier)
        if target:
            lines.append(f"- `{identifier}`: **{target['availability']}**.")
    lines += ["", "## Границы", ""] + ["- " + text for text in crosswalk["limitations"]]
    lines += ["", "Подготовленные материалы не присваивают ученику CEFR. Для проверки владения нужны самостоятельные ответы на новые задачи, обратная связь, понимание живой речи и длительная практика.", "",
              "Авторские связи B1/B2, адреса источников и их хеши хранятся в `content/crosswalk-inputs/` и переносятся вместе с проектом. Повторная сборка карты через `build_foundation_crosswalk.py` не требует приватной папки `data`. Если проверенные PDF присутствуют локально, обновление дополнительно сверяет их SHA-256.", "",
              "Обновление доступности без генерации уроков:", "", "```powershell", "python app/scripts/refresh_foundation_crosswalk.py", "```", ""]
    (APP / "docs/FOUNDATION-BOOK-CROSSWALK.md").write_text("\n".join(lines), encoding="utf-8")


def refresh():
    path = CONTENT / "foundation-book-crosswalk.json"
    crosswalk = read(path)
    target_ids = validate_rows(crosswalk["sources"])
    catalog = catalog_units(CONTENT / "library.json")
    metadata = {u["id"]: (b, u) for b in read(CONTENT / "library.json")["books"]
                if not b.get("duplicateOf") for u in b["units"]}
    release = read(CONTENT / "book-release.json").get("units", {})
    modules = {m["id"]: m for m in read(CONTENT / "extended-course-plan.json")["modules"]}
    pronunciation = {p["id"]: p for p in read(CONTENT / "pronunciation.json")["lessons"]}
    courses = {}
    for file in [CONTENT / "curriculum.json", *sorted((CONTENT / "courses").glob("*.json"))]:
        value = read(file)
        for lesson in value if isinstance(value, list) else [value]:
            if lesson["id"] in courses:
                raise ValueError("Duplicate course ID " + lesson["id"])
            courses[lesson["id"]] = (file, lesson)
    targets = {}
    for identifier in target_ids:
        target = targets[identifier] = dict(id=identifier, availability="catalog-only")
        if identifier in catalog:
            book, unit = metadata[identifier]
            file = CONTENT / "book-lessons" / (identifier + ".json")
            target.update(kind="book-unit", title=unit["title"], level=book["level"],
                          path=file.relative_to(APP).as_posix(), href="#/unit/" + identifier)
            if not file.exists():
                continue
            try:
                lesson = read(file)
                private = APP / "data/parsed-books" / (identifier + ".json")
                if private.exists():
                    result = validate_unit(identifier, catalog[identifier], file,
                                           APP / "data/parsed-books", APP / "data/book-page-images")
                    sha = result["lessonSHA256"]
                    target["validationBasis"] = "local-source-and-page-hashes"
                else:
                    sha = hashlib.sha256(file.read_bytes()).hexdigest()
                    if release.get(identifier, {}).get("lessonSHA256") != sha:
                        raise ValueError("No source or matching portable release")
                    validate_lesson(lesson, catalog[identifier]["pages"] if lesson.get("provenance", {}).get("visualSourceUsed") else None)
                    target["validationBasis"] = "portable-release-hash"
                evidence = course_evidence(lesson)
                target.update(evidence=evidence, fileSHA256=sha,
                              portableRelease=release.get(identifier, {}).get("lessonSHA256") == sha,
                              availability="reference-pending" if evidence["referencesPending"] else "available")
            except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
                target.update(availability="unavailable", error=str(error))
        elif identifier in pronunciation:
            lesson = pronunciation[identifier]
            if len(lesson.get("explanation", [])) < 2 or not lesson.get("practice", {}).get("reference"):
                raise ValueError("Incomplete pronunciation lesson " + identifier)
            target.update(kind="pronunciation", title=lesson["title"], level=lesson["level"],
                          path="content/pronunciation.json", href="#/pronunciation/" + identifier,
                          availability="available", evidence=dict(lessonObjectSHA256=digest(lesson),
                              sectionTitles=[s["title"] for s in lesson["explanation"]],
                              practicePrompt=lesson["practice"]["prompt"]))
        elif identifier in courses or identifier in modules:
            if identifier not in courses:
                target.update(kind="extended", title=modules[identifier]["title"])
                continue
            file, lesson = courses[identifier]
            target.update(kind="extended" if identifier in modules else "course", title=lesson["title"],
                          level=lesson["level"], path=file.relative_to(APP).as_posix(), href="#/lesson/" + identifier)
            try:
                if identifier in modules:
                    validate_extended(lesson, modules[identifier])
                    provenance = lesson.get("provenance", {})
                    if provenance.get("specHash") != spec_hash(modules[identifier]) or provenance.get("promptVersion") != VERSION:
                        raise ValueError("Extended lesson specification mismatch")
                evidence = course_evidence(lesson)
                target.update(evidence=evidence, availability="reference-pending" if evidence["referencesPending"] else "available")
            except (ValueError, KeyError, TypeError, AttributeError) as error:
                target.update(availability="unavailable", error=str(error))
        else:
            raise ValueError("Unknown lesson ID: " + identifier)
    crosswalk["targets"] = targets
    crosswalk["availabilityCheckedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    crosswalk["availabilitySummary"] = dict(Counter(t["availability"] for t in targets.values()))
    for source in crosswalk["sources"]:
        unique = {i for row in source["rows"] for d in row["dimensions"] for i in d["targets"]}
        source["availabilitySummary"] = dict(Counter(targets[i]["availability"] for i in unique))
        source["editorialSummary"] = dict(Counter(d["coverage"] for row in source["rows"] for d in row["dimensions"]))
    atomic_json(path, crosswalk)
    write_report(crosswalk)
    print(json.dumps(crosswalk["availabilitySummary"], ensure_ascii=False))
    return crosswalk


if __name__ == "__main__":
    refresh()

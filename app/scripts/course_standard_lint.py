"""Mechanical gate for docs/COURSE-STANDARD.md. It finds repetition, filler,
British forms and structural mistakes; it cannot judge teaching quality.

Usage:
  python app/scripts/course_standard_lint.py FILE_OR_DIR...   # staged lessons
  python app/scripts/course_standard_lint.py --content          # every guided lesson
Exit code 1 when any error is found.
"""
import argparse
import difflib
import json
import re
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
CONTENT = APP / "content"
LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]
KINDS = {"translate", "rewrite", "write", "speak"}
SECTION_LIMIT = {"A1": 450, "A2": 450, "B1": 700, "B2": 700, "C1": 900, "C2": 900}
GUIDANCE_WORDS = {"A1": 60, "A2": 60, "B1": 80, "B2": 80, "C1": 80, "C2": 80}
OPEN_WORDS = {"A1": 30, "A2": 70, "B1": 140, "B2": 200, "C1": 280, "C2": 300}
CYRILLIC = re.compile(r"[А-Яа-яЁё]")
BOILERPLATE = [
    "Одна небольшая задача", "Напишите всю мысль самостоятельно", "Попробуй без образца. Если трудно",
    "Короткий свободный ответ", "Сохраните исходный смысл", "Говорите 90–150 секунд",
    "Здесь проверяется применение", "Учебная мини-ситуация перед основной практикой",
    "Авторский учебный материал. Все люди", "Сначала собственная попытка",
]
BUREAUCRATIC = [
    (r"\bданн(ый|ая|ое|ые|ого|ой|ом|ым|ых)\b", "«данный»"), (r"\bявля(ется|ются|лся|лась|лись)\b", "«является»"),
    (r"\bосуществл", "«осуществлять»"), (r"\bв рамках\b", "«в рамках»"), (r"перенос навыка", "«перенос навыка»"),
    (r"коммуникативн\w* задач", "«коммуникативная задача»"), (r"информационн\w* задач", "«информационная задача»"),
    (r"[Ии]ллюстративн\w* образ", "«иллюстративный образец»"), (r"[Аа]вторск\w* учебн\w* материал", "«авторский учебный материал»"),
    (r"проверяется применение", "«проверяется применение»"), (r"[Сс]охраните смысл", "«сохраните смысл»"),
]
VY_FORMS = re.compile(r"\b(Напишите|Переведите|Исправьте|Скажите|Сравните|Объясните|Прочитайте|Послушайте|Используйте|"
                      r"Перепишите|Составьте|Произнесите|Ответьте|Опишите|Выберите|Запишите|Представьте|Сделайте|"
                      r"Подумайте|Сформулируйте|Передайте|Добавьте|Уберите|Замените|Постарайтесь|Говорите|Проверьте)\b")
TERMS = ["регистр", "инверси", "номинализ", "эллипсис", "импликатур", "модальност", "когези", "дискурс", "предикат",
         "аспект", "герунди", "инфинитив", "причасти", "клауз"]
# British forms that never belong in American answers, examples or materials.
BRITISH_ERR = r"""colour\w*|favourite\w*|centre\w*|theatre\w*|realis(e|ed|es|ing|ation)|organis(e|ed|es|ing|ation\w*)|recognis(e|ed|es|ing)|
apologis(e|ed|es|ing)|analys(e|ed|es|ing)|criticis(e|ed|es|ing)|emphasis(e|ed|es|ing)|summaris(e|ed|es|ing)|prioritis(e|ed|es|ing)|
minimis(e|ed|es|ing)|maximis(e|ed|es|ing)|specialis(e|ed|es|ing)|practis(e|ed|es|ing)|programme\w*|travell(ed|er|ers|ing)|
cancell(ed|ing)|labell(ed|ing)|modell(ed|ing)|jewellery|catalogue\w*|grey|cheque\w*|defence|offence|learnt|spelt|dreamt|
whilst|amongst|fortnight\w*|mobile phone\w*|autumn|rubbish|petrol|lorr(y|ies)|motorway\w*|pavement\w*|postcode\w*|maths|
car park\w*|biscuits?|crisps|trousers|nappy|nappies|dustbin\w*|Mum|mum|CV|CVs|shop assistant\w*|ground floor|at the weekend|
in hospital|neighbour\w*|behaviour\w*|favour\w*|honour\w*|labour\w*|humour\w*|flavour\w*|rumour\w*|harbour\w*|metre\w*|
litre\w*|fibre\w*|kilometre\w*|tyres?|kerb\w*|aluminium|judgement\w*|sceptic\w*|pyjamas|storey\w*|aeroplane\w*|manoeuvr\w*|
mould\w*|cosy|moustache\w*|enquir(e|y|ies|ed)|draught\w*|plough\w*|full stops?|Have you got|have got|has got|haven't got|hasn't got"""
BRITISH_WARN = r"""flat|flats|flatmate\w*|lift|queue\w*|holiday\w*|timetable\w*|trainers|sweets|jumper\w*|torch\w*|cinema\w*|
football|towards|afterwards|film|films|bill|term|garden\w*|chips|revise|revision|tap|toilet\w*|post|mate|cheers|brilliant|lovely|rubber"""
BRIT_ERR = re.compile(r"(?<![A-Za-z'’-])(" + BRITISH_ERR.replace("\n", "") + r")(?![A-Za-z-])")
BRIT_WARN = re.compile(r"(?<![A-Za-z'’-])(" + BRITISH_WARN.replace("\n", "") + r")(?![A-Za-z-])")
UK_DATE = re.compile(r"\b\d{1,2}(st|nd|rd|th)? (January|February|March|April|May|June|July|August|September|October|November|December)\b")
UK_TITLE = re.compile(r"\b(Mr|Mrs|Ms|Dr)\s+[A-Z]")
UK_TIME = re.compile(r"\b\d{1,2}(\.\d\d)?\s?(am|pm)\b")


def words(text):
    return len(re.findall(r"\S+", text or ""))


def norm(text):
    return re.sub(r"[\s’'\".,!?;:—–-]+", " ", str(text or "").lower()).strip()


def sentences(text):
    return [s.strip() for s in re.split(r"(?<=[.!?…])\s+", text or "") if s.strip()]


def route_order():
    path = json.loads((CONTENT / "learning-path.json").read_text(encoding="utf-8"))
    order = []
    for level in path["levels"]:
        for lesson_id in level["lessonIds"]:
            if lesson_id not in order:
                order.append(lesson_id)
    return order


def known_lessons():
    known = {}
    for path in [CONTENT / "curriculum.json", *sorted((CONTENT / "courses").glob("*.json"))]:
        for lesson in json.loads(path.read_text(encoding="utf-8")):
            known[lesson["id"]] = lesson
    return known


def english_fields(lesson):
    for i, e in enumerate(lesson.get("examples", [])):
        yield f"examples[{i}].en", e.get("en", "")
    for m in lesson.get("materials", []) or []:
        yield f"materials[{m.get('id')}]", m.get("text", "")
    visual = lesson.get("visual") or {}
    for i, item in enumerate(visual.get("items", []) or []):
        yield f"visual.items[{i}].en", item.get("en", "")
    for e in lesson.get("exercises", []):
        for i, a in enumerate(e.get("answers", []) or []):
            yield f"{e.get('id')}.answers[{i}]", a
        if e.get("guidance"):
            yield f"{e.get('id')}.guidance.example", e["guidance"].get("example", "")


def russian_fields(lesson):
    for key in ("title", "subtitle", "goal"):
        yield key, lesson.get(key, "")
    for i, s in enumerate(lesson.get("sections", [])):
        yield f"sections[{i}]", s.get("title", "") + ". " + s.get("body", "")
    for i, e in enumerate(lesson.get("examples", [])):
        yield f"examples[{i}].why", e.get("why", "")
    for e in lesson.get("exercises", []):
        eid = e.get("id")
        for key in ("prompt", "context", "hint", "explanation"):
            yield f"{eid}.{key}", e.get(key, "")
        if e.get("guidance"):
            yield f"{eid}.guidance", e["guidance"].get("title", "") + ". " + e["guidance"].get("body", "")


def lint(lesson, order, known):
    errors, warnings = [], []
    err = lambda msg: errors.append(msg)
    warn = lambda msg: warnings.append(msg)
    lid = lesson.get("id", "?")
    level = str(lesson.get("level", ""))[:2]
    if level not in LEVELS:
        err(f"level must start with A1..C2, got {lesson.get('level')!r}")
        level = "B1"
    for key in ("id", "title", "subtitle", "level", "group", "units", "goal", "formula"):
        if not isinstance(lesson.get(key), str) or not lesson[key].strip():
            err(f"missing text field {key}")
    if lesson.get("guided") is not True:
        err("guided must be true")
    if not isinstance(lesson.get("minutes"), int) or not 10 <= lesson["minutes"] <= 90:
        err("minutes must be an integer 10..90")
    if "courseGuide" in lesson:
        err("a guided lesson must not embed courseGuide")

    # Route position: prerequisites and recycled topics come earlier.
    position = {x: i for i, x in enumerate(order)}
    here = position.get(lid)
    for field in ("prerequisites", "recycles"):
        values = lesson.get(field, [])
        if not isinstance(values, list) or any(not isinstance(v, str) for v in values):
            err(f"{field} must be a list of lesson ids")
            continue
        for v in values:
            if v not in known:
                err(f"{field}: unknown lesson {v}")
            elif here is not None and v in position and position[v] >= here:
                err(f"{field}: {v} is not earlier in the route than {lid}")
    if here is not None and here >= 2 and not lesson.get("recycles"):
        err("recycles: from the third lesson on, name 1-2 earlier lessons reused in a task")
    teaches = lesson.get("teaches")
    if not isinstance(teaches, list) or not 3 <= len(teaches) <= 12 or any(not isinstance(t, str) or not t.strip() for t in teaches):
        err("teaches must list 3..12 short points")
    sources = lesson.get("sources")
    if not isinstance(sources, list) or not 1 <= len(sources) <= 4:
        err("sources must list 1..4 checked references")
    else:
        for s in sources:
            if not isinstance(s, dict) or not str(s.get("url", "")).startswith("https://") or not s.get("title") or not s.get("notes"):
                err(f"source needs https url, title and notes: {s}")

    sections = lesson.get("sections", [])
    if not isinstance(sections, list) or not 3 <= len(sections) <= 6:
        err("sections: 3..6 required")
        sections = sections if isinstance(sections, list) else []
    for i, s in enumerate(sections):
        # The opening section carries the "why" and may be twice as long.
        limit = SECTION_LIMIT[level] * (2 if i == 0 else 1)
        body = s.get("body", "")
        if not s.get("title") or not body:
            err(f"sections[{i}] empty")
        if len(body) > limit * 1.5:
            err(f"sections[{i}] is {len(body)} chars; keep it near {limit}")
        elif len(body) > limit:
            warn(f"sections[{i}] is {len(body)} chars (target ≤{limit})")
        long = [x for x in sentences(body) if words(x) > 28]
        if long:
            warn(f"sections[{i}] long sentence: {long[0][:90]}…")
        if s.get("title", "").strip() in {"Смысл и ситуация", "Как выбрать форму и построить мысль", "Типичная ловушка и перенос в речь"}:
            err(f"sections[{i}] generic heading {s['title']!r}")
    intro = lesson.get("introSections")
    if not isinstance(intro, int) or not 1 <= intro <= max(1, len(sections)):
        err("introSections must be 1..len(sections)")
    if "introExamples" in lesson and (not isinstance(lesson["introExamples"], int) or lesson["introExamples"] < 0):
        err("introExamples must be a non-negative integer")

    examples = lesson.get("examples", [])
    if not isinstance(examples, list) or not 4 <= len(examples) <= 8:
        err("examples: 4..8 required")
        examples = examples if isinstance(examples, list) else []
    for i, e in enumerate(examples):
        if not e.get("en") or not e.get("ru") or not e.get("why"):
            err(f"examples[{i}] needs en, ru, why")
        if CYRILLIC.search(e.get("en", "")):
            err(f"examples[{i}].en contains Cyrillic")

    visual = lesson.get("visual")
    if visual is not None:
        items = visual.get("items") if isinstance(visual, dict) else None
        if not isinstance(visual, dict) or visual.get("kind") not in {"contrast", "sequence", "timeline", "scale"} or not visual.get("title") or not visual.get("why") or not isinstance(items, list) or not 2 <= len(items) <= 4:
            err("visual: kind contrast|sequence|timeline|scale, title, why and 2..4 items")
        else:
            for i, item in enumerate(items):
                if not all(item.get(k) for k in ("label", "en", "ru", "note")):
                    err(f"visual.items[{i}] needs label, en, ru, note")
                if norm(item.get("en")) in {norm(e.get("en")) for e in examples}:
                    warn(f"visual.items[{i}] repeats an example verbatim")

    materials = {m.get("id") for m in lesson.get("materials", []) or []}
    exercises = lesson.get("exercises", [])
    if not isinstance(exercises, list) or not 6 <= len(exercises) <= 14:
        err("exercises: 6..14 required")
        exercises = exercises if isinstance(exercises, list) else []
    ids, stages = set(), []
    section_bodies = [s.get("body", "") for s in sections]
    guidance_bodies = {}
    for e in exercises:
        eid = e.get("id", "?")
        if not re.fullmatch(r"e\d{1,2}", str(eid)) or eid in ids:
            err(f"{eid}: ids must be unique e1..eN")
        ids.add(eid)
        if "revision" in e:
            err(f"{eid}: do not set revision; the apply script computes it")
        kind, stage = e.get("kind"), e.get("practiceStage")
        stages.append(stage)
        if kind not in KINDS:
            err(f"{eid}: kind must be one of {sorted(KINDS)}")
        if stage not in {"guided", "independent"}:
            err(f"{eid}: practiceStage must be guided or independent")
        for key in ("prompt", "hint", "explanation"):
            if not isinstance(e.get(key), str) or not e[key].strip():
                err(f"{eid}: empty {key}")
        if not isinstance(e.get("context", ""), str):
            err(f"{eid}: context must be a string")
        answers = e.get("answers") or []
        if not answers and (stage == "guided" or kind in {"translate", "rewrite"}):
            err(f"{eid}: answers required")
        for a in answers:
            if CYRILLIC.search(a):
                err(f"{eid}: answer contains Cyrillic: {a[:60]}")
        if kind in {"write", "speak"} and answers:
            longest = max(words(a) for a in answers)
            if longest > OPEN_WORDS[level]:
                warn(f"{eid}: model answer has {longest} words (level target ≤{OPEN_WORDS[level]})")
        for m in e.get("materialIds", []) or []:
            if m not in materials:
                err(f"{eid}: unknown material {m}")
        context = e.get("context", "") or ""
        for phrase in BOILERPLATE:
            if phrase in context or phrase in e.get("prompt", ""):
                err(f"{eid}: boilerplate filler «{phrase}…»")
        hint = e.get("hint", "")
        if norm(hint) in {norm(lesson.get("goal")), norm(lesson.get("formula"))}:
            err(f"{eid}: hint repeats the lesson goal/formula")
        g = e.get("guidance")
        if stage == "guided":
            if not isinstance(g, dict) or not all(str(g.get(k, "")).strip() for k in ("title", "body", "example", "translation")):
                err(f"{eid}: guided task needs guidance title/body/example/translation")
                continue
            body = g["body"]
            if words(body) > GUIDANCE_WORDS[level] * 1.4:
                err(f"{eid}: guidance body {words(body)} words (target ≤{GUIDANCE_WORDS[level]})")
            elif words(body) > GUIDANCE_WORDS[level]:
                warn(f"{eid}: guidance body {words(body)} words (target ≤{GUIDANCE_WORDS[level]})")
            if norm(hint) == norm(body) or (len(hint) > 40 and norm(hint) in norm(body)):
                err(f"{eid}: hint repeats the guidance card")
            for i, sb in enumerate(section_bodies):
                if norm(body) == norm(sb) or (len(body) > 60 and norm(body) in norm(sb)):
                    err(f"{eid}: guidance copies sections[{i}]")
                elif difflib.SequenceMatcher(None, norm(body), norm(sb)).ratio() > 0.8:
                    err(f"{eid}: guidance nearly copies sections[{i}]")
            if norm(body) in guidance_bodies:
                err(f"{eid}: guidance body duplicates {guidance_bodies[norm(body)]}")
            guidance_bodies[norm(body)] = eid
            if norm(g["example"]) in {norm(a) for a in answers}:
                err(f"{eid}: guidance example is the answer itself")
            if CYRILLIC.search(g["example"]):
                err(f"{eid}: guidance example must be English")
        elif g:
            err(f"{eid}: independent task must not have guidance")
    if stages and stages[0] != "guided":
        err("the first task must be guided")
    if "independent" in stages and "guided" in stages[stages.index("independent"):]:
        err("guided tasks must come before independent tasks")
    independent = stages.count("independent")
    if independent == 0:
        err("at least one independent task is required")
    elif independent == 1:
        warn("only one independent task (standard: 2-3)")
    open_kinds = {e.get("kind") for e in exercises if e.get("practiceStage") == "independent"}
    if level != "A1" and "speak" not in {e.get("kind") for e in exercises}:
        warn("no speaking task")
    if "write" not in open_kinds and "speak" not in open_kinds:
        warn("independent tasks should include writing or speaking")

    prompts = [norm(e.get("prompt")) for e in exercises]
    for i in range(len(prompts)):
        for j in range(i + 1, len(prompts)):
            if prompts[i] and difflib.SequenceMatcher(None, prompts[i], prompts[j]).ratio() > 0.88:
                warn(f"{exercises[i].get('id')} and {exercises[j].get('id')} prompts are nearly identical")
    contexts = [norm(e.get("context")) for e in exercises if norm(e.get("context"))]
    for c in set(contexts):
        if contexts.count(c) > 2:
            err(f"the same context is repeated {contexts.count(c)} times: {c[:70]}")
    hints = [norm(e.get("hint")) for e in exercises if norm(e.get("hint"))]
    for h in set(hints):
        if hints.count(h) > 1:
            err(f"the same hint is repeated {hints.count(h)} times: {h[:70]}")

    # A sentence of real length must not be pasted into two different places.
    seen = {}
    for where, text in russian_fields(lesson):
        for sentence in sentences(text):
            key = norm(sentence)
            if words(sentence) >= 7 and CYRILLIC.search(sentence):
                if key in seen and seen[key].split(".")[0] != where.split(".")[0]:
                    err(f"sentence repeated in {seen[key]} and {where}: {sentence[:80]}")
                seen.setdefault(key, where)
    for where, text in russian_fields(lesson):
        for pattern, label in BUREAUCRATIC:
            if re.search(pattern, text or ""):
                err(f"{where}: bureaucratic/meta wording {label}")
        match = VY_FORMS.search(text or "")
        if match:
            err(f"{where}: use «ты», not «{match.group(1)}»")
    theory = " ".join(s.get("body", "") for s in sections)
    for term in TERMS:
        if re.search(term, theory, re.I):
            first = next(x for x in sentences(theory) if re.search(term, x, re.I))
            if not re.search(r"—|\(|то есть|значит|это когда|называют", first):
                warn(f"term «{term}…» may need a plain explanation: {first[:90]}")

    for where, text in english_fields(lesson):
        text = text or ""
        for m in BRIT_ERR.finditer(text):
            err(f"{where}: British form «{m.group(1)}» — use American English")
        for m in BRIT_WARN.finditer(text):
            warn(f"{where}: check American usage of «{m.group(1)}»")
        if "£" in text:
            err(f"{where}: £ — use dollars")
        if UK_DATE.search(text):
            err(f"{where}: British date «{UK_DATE.search(text).group(0)}» — use May 6")
        if UK_TITLE.search(text):
            err(f"{where}: American titles take a period: {UK_TITLE.search(text).group(0)}")
        if UK_TIME.search(text):
            warn(f"{where}: write times as 6:30 p.m.: {UK_TIME.search(text).group(0)}")
    return errors, warnings


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("paths", nargs="*", type=Path)
    parser.add_argument("--content", action="store_true", help="lint every guided lesson in app/content")
    parser.add_argument("--quiet", action="store_true", help="print warnings only as a count")
    args = parser.parse_args(argv)
    order, known = route_order(), known_lessons()
    lessons = []
    for p in args.paths:
        files = sorted(p.glob("*.json")) if p.is_dir() else [p]
        for f in files:
            try:
                lessons.append((str(f), json.loads(f.read_text(encoding="utf-8-sig"))))
            except (OSError, json.JSONDecodeError) as exc:
                print(f"{f}: cannot read JSON: {exc}")
                return 1
    if args.content:
        lessons += [("content:" + l["id"], l) for l in known.values() if l.get("guided")]
    for _, lesson in lessons:  # a new lesson may be referenced by the next staged one
        known.setdefault(lesson.get("id"), lesson)
    total_e = total_w = 0
    for name, lesson in lessons:
        errors, warnings = lint(lesson, order, known)
        total_e += len(errors)
        total_w += len(warnings)
        status = "OK" if not errors else f"{len(errors)} errors"
        print(f"== {lesson.get('id', name)}: {status}, {len(warnings)} warnings")
        for e in errors:
            print("  ERROR", e)
        if not args.quiet:
            for w in warnings:
                print("  warn ", w)
    print(f"TOTAL {len(lessons)} lessons, {total_e} errors, {total_w} warnings")
    return 1 if total_e else 0


if __name__ == "__main__":
    sys.exit(main())

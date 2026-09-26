"""Print a lesson in the order a learner meets it, for editorial review.

  python app/scripts/render_course_lesson.py path-be            # current content
  python app/scripts/render_course_lesson.py staged/path-x.json  # a staged rewrite
"""
import json
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
CONTENT = APP / "content"


def load(ref):
    path = Path(ref)
    if path.suffix == ".json" and path.exists():
        return json.loads(path.read_text(encoding="utf-8-sig")), None
    guide = None
    for p in sorted(CONTENT.glob("course-guides-*.json")):
        guide = next((g for g in json.loads(p.read_text(encoding="utf-8"))["lessons"] if g["lessonId"] == ref), guide)
    for p in [CONTENT / "curriculum.json", *sorted((CONTENT / "courses").glob("*.json"))]:
        for lesson in json.loads(p.read_text(encoding="utf-8")):
            if lesson["id"] == ref:
                return lesson, guide
    raise SystemExit(f"lesson not found: {ref}")


def render(lesson, guide=None, out=print):
    out(f"# {lesson['id']} · {lesson.get('level')} · {lesson['title']}")
    out(f"  {lesson.get('subtitle', '')} | цель: {lesson.get('goal', '')} | формула: {lesson.get('formula', '')}")
    out(f"  prerequisites={lesson.get('prerequisites', [])} recycles={lesson.get('recycles', [])}")
    for t in lesson.get("teaches", []):
        out(f"  teaches: {t}")
    sections = lesson.get("sections", [])
    shown = lesson.get("introSections") or len(sections)
    out("\n## ВСТУПЛЕНИЕ")
    for i, s in enumerate(sections):
        if i == shown:
            out("\n## СПРАВОЧНИК («Напомнить правило»), во вступлении не показан")
        out(f"\n### {s['title']}\n{s['body']}")
    if lesson.get("visual"):
        v = lesson["visual"]
        out(f"\n### Схема ({v['kind']}): {v['title']}\n{v['why']}")
        for item in v["items"]:
            out(f"  - {item['label']}: {item['en']} = {item['ru']} // {item['note']}")
    out("\n### Примеры")
    for e in lesson.get("examples", []):
        out(f"  - {e['en']} = {e['ru']} // {e['why']}")
    for m in lesson.get("materials", []) or []:
        out(f"\n### Материал {m['id'].upper()} ({m['kind']}): {m['title']}\n{m['text']}")
    if guide:
        out("\n## НАЛОЖЕННЫЙ GUIDE (второй слой объяснений)")
        for s in guide.get("explanation", []):
            out(f"\n### {s['title']}\n{s['body']}")
    exercises = lesson.get("exercises", [])
    if guide:
        replaced = {e["id"]: e for e in guide.get("replacements", [])}
        exercises = guide.get("practice", []) + [replaced.get(e["id"], e) for e in exercises]
    out("\n## ЗАДАНИЯ")
    for e in exercises:
        out(f"\n--- {e['id']} · {e['kind']} · {e.get('practiceStage', '')}" + (f" · материалы {e['materialIds']}" if e.get("materialIds") else ""))
        g = e.get("guidance")
        if g:
            out(f"  [карточка] {g['title']}: {g['body']}\n             {g['example']} — {g['translation']}")
        out(f"  ЗАДАНИЕ: {e['prompt']}")
        if e.get("context"):
            out(f"  условие: {e['context']}")
        out(f"  подсказка: {e.get('hint', '')}")
        for a in e.get("answers", []):
            out(f"  ответ: {a}")
        out(f"  после проверки: {e.get('explanation', '')}")
    if lesson.get("sources"):
        out("\n## Источники")
        for s in lesson["sources"]:
            out(f"  - {s['title']} <{s['url']}> — {s.get('notes', '')}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    for ref in sys.argv[1:]:
        render(*load(ref))
        print()

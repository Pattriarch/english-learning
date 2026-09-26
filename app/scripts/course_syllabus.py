"""What the learner already knows before a lesson: the route in order, with each
earlier lesson's `teaches` list (or its goal and formula if not yet rewritten).

  python app/scripts/course_syllabus.py path-plurals        # lessons before it
  python app/scripts/course_syllabus.py --all               # whole route
"""
import json
import sys
from pathlib import Path

CONTENT = Path(__file__).resolve().parents[1] / "content"


def main(argv):
    sys.stdout.reconfigure(encoding="utf-8")
    path = json.loads((CONTENT / "learning-path.json").read_text(encoding="utf-8"))
    route = json.loads((CONTENT / "study-route.json").read_text(encoding="utf-8"))
    lessons = {}
    for p in [CONTENT / "curriculum.json", *sorted((CONTENT / "courses").glob("*.json"))]:
        for lesson in json.loads(p.read_text(encoding="utf-8")):
            lessons[lesson["id"]] = lesson
    target = None if not argv or argv[0] == "--all" else argv[0]
    number = 0
    for level in path["levels"]:
        print(f"== {level['id']}: {level['title']}")
        for lesson_id in level["lessonIds"]:
            if lesson_id == target:
                print(f"   >>> {lesson_id} (this lesson)")
                return 0
            number += 1
            lesson = lessons.get(lesson_id)
            optional = " (необязательный обзор)" if lesson_id in route["overviewLessonIds"] else ""
            if lesson is None:
                print(f"   {number:3}. {lesson_id}: NEW, not written yet{optional}")
                continue
            print(f"   {number:3}. {lesson_id}: {lesson['title']}{optional}")
            if lesson.get("teaches"):
                for point in lesson["teaches"]:
                    print(f"          · {point}")
            else:
                print(f"          · цель: {lesson.get('goal', '')} | формула: {lesson.get('formula', '')}")
    return 0 if target is None else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

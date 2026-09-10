"""Read-only candidates where a reference falls outside a stated word range.

Only a single explicit total word range in a prompt is considered. Per-message
or per-paragraph ranges are excluded because their total is not comparable. This is
not a semantic rubric: approximate speaking targets still require human review.
Never changes prompts, reference answers, or limits to make a test pass.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re

from publish_book_release import atomic_json

APP = Path(__file__).resolve().parents[1]
RANGE = re.compile(r'(\d+)\s*[–—-]\s*(\d+)\s+(?:английских\s+)?слов')
PER_PART_RANGE = re.compile(r'\bпо\s+\d+\s*[–—-]\s*\d+\s+(?:английских\s+)?слов', re.I)


def inspect_exercise(unit, exercise):
    prompt = exercise.get('prompt', '')
    if PER_PART_RANGE.search(prompt):
        return None, False
    bounds = RANGE.findall(prompt)
    answers = exercise.get('answers', [])
    if len(bounds) != 1 or not answers or not isinstance(answers[0], str):
        return None, False
    lower, upper = map(int, bounds[0])
    if lower > upper or lower < 1:
        return None, False
    count = len(answers[0].split())
    if lower <= count <= upper:
        return None, True
    return {'unit': unit, 'exercise': exercise.get('id'), 'lower': lower, 'upper': upper,
            'count': count, 'prompt': exercise['prompt'], 'context': exercise.get('context', ''),
            'answer': answers[0], 'explanation': exercise.get('explanation', '')}, True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lessons', type=Path, default=APP/'content/book-lessons')
    parser.add_argument('--output', type=Path, default=APP/'data/book-answer-length-audit.json')
    args = parser.parse_args()
    files = sorted(args.lessons.glob('*.json'))
    candidates, errors, checked = [], [], 0
    for path in files:
        try:
            lesson = json.loads(path.read_text(encoding='utf-8'))
            for exercise in lesson.get('exercises', []):
                candidate, counted = inspect_exercise(path.stem, exercise)
                checked += counted
                if candidate:
                    candidates.append(candidate)
        except (OSError, ValueError, TypeError, AttributeError, KeyError) as error:
            errors.append({'unit': path.stem, 'error': type(error).__name__})
    atomic_json(args.output, {'at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'files': len(files), 'checkedReferences': checked,
        'method': 'One explicit total word range, excluding per-part limits; whitespace tokens including numerals. Human review required.',
        'candidates': candidates, 'errors': errors})
    print(json.dumps({'files': len(files), 'checked': checked, 'candidates': len(candidates), 'errors': len(errors)}))
    return 1 if candidates or errors else 0


if __name__ == '__main__':
    raise SystemExit(main())

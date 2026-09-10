"""Read-only audit of explicit reference-answer word-count claims.

This reports candidates; it never rewrites answers, prompts, or explanations.
Tokens separated by whitespace (including standalone numerals) count as words,
matching the lesson builder and validator.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re

from build_book_lessons import atomic_json

APP = Path(__file__).resolve().parents[1]
CLAIM = re.compile(r'(?P<prefix>Образец содержит|В образце|Ответ содержит|В ответе|Модель содержит|В модели)\s+(?P<count>\d+)\s+слов(?:о|а)?\b')


def inspect_lesson(unit, lesson, min_difference=1):
    candidates = []
    for exercise in lesson.get('exercises', []):
        answers = exercise.get('answers', [])
        explanation = exercise.get('explanation', '')
        if not isinstance(answers, list) or not answers or not isinstance(answers[0], str) or not isinstance(explanation, str):
            continue
        count = len(answers[0].split())
        for match in CLAIM.finditer(explanation):
            declared = int(match['count'])
            if abs(count - declared) < min_difference:
                continue
            candidates.append({'unit': unit, 'exercise': exercise.get('id'),
                'declared': declared, 'count': count, 'difference': count-declared,
                'claim': match[0], 'prompt': exercise.get('prompt', ''),
                'answer': answers[0], 'explanation': explanation})
    return candidates


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lessons', type=Path, default=APP/'content/book-lessons')
    parser.add_argument('--output', type=Path, default=APP/'data/book-reference-counts-audit.json')
    parser.add_argument('--min-difference', type=int, default=1)
    args = parser.parse_args()
    if args.min_difference < 1:
        parser.error('--min-difference must be positive')
    candidates, errors = [], []
    files = sorted(args.lessons.glob('*.json'))
    for path in files:
        try:
            lesson = json.loads(path.read_text(encoding='utf-8'))
            candidates += inspect_lesson(path.stem, lesson, args.min_difference)
        except (OSError, ValueError, TypeError, AttributeError) as error:
            errors.append({'unit': path.stem, 'error': type(error).__name__})
    atomic_json(args.output, {'at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'files': len(files), 'minDifference': args.min_difference,
        'countingMethod': 'Whitespace-separated tokens including numerals',
        'candidates': candidates, 'errors': errors})
    print(json.dumps({'files': len(files), 'candidates': len(candidates), 'errors': len(errors),
        'units': sorted({c['unit'] for c in candidates})}))
    return 1 if candidates or errors else 0


if __name__ == '__main__':
    raise SystemExit(main())

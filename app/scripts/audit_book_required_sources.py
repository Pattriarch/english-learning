"""Find prompts worth checking for a missing required source, without editing.

A match is not a defect: context/examples may contain all the needed material,
or a prompt may explicitly invite the learner to choose their own source.
"""
import argparse
from datetime import datetime, timezone
import json
import hashlib
from pathlib import Path
import re

from build_book_lessons import atomic_json

APP = Path(__file__).resolve().parents[1]
PATTERNS = [
    re.compile(r'(?:прослушайте|послушайте|просмотрите|посмотрите|прочитайте|прочтите|прочти|сверьтесь|найдите)\s+[^.!?\n]{0,100}?(?:запис\w*|аудио\w*|видео\w*|стать\w*|субтитр\w*|сцен\w*|фрагмент\w*|эпизод\w*|рисун\w*|картин\w*|фотограф\w*|таблиц\w*|текст\w*)', re.I),
    re.compile(r'(?:на|по|из|в)\s+(?:(?:этой|этом|этого|следующей|следующем|приведенной|приведённой)\s+)?(?:картинке|фотографии|иллюстрации|таблице|рисунке|видео|аудиозаписи|аудиофрагменте|субтитрах)\b', re.I),
    re.compile(r'(?:текст|таблиц\w*|стать\w*|пример\w*|рисунок|иллюстраци\w*)\s+(?:выше|ниже|прилагается|прилагаются)\b', re.I),
    re.compile(r'(?:на основе|опираясь на|используя|по данным|из)\s+[^.!?\n]{0,50}?(?:текст\w*|таблиц\w*|стать\w*|рисун\w*|фотограф\w*|иллюстраци\w*|график\w*|схем\w*|фрагмент\w*|запис\w*)', re.I),
    re.compile(r'(?:по|на)\s+(?:графику|графике|схеме|рисунку|картинке)\b|(?:приведённ\w*|приведенн\w*|прилагаем\w*|приложенн\w*)\s+(?:таблиц\w*|текст\w*|рисун\w*|стать\w*)', re.I),
    re.compile(r'\b(?:listen to|watch|look at|read)\s+[^.!?\n]{0,50}?(?:recording|audio|video|article|picture|photograph|table|text|passage)\b', re.I),
]


def evidence_hash(candidate):
    raw = json.dumps({key:candidate.get(key, '') for key in ('prompt', 'context')}, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def attach_review(candidate, reviews):
    candidate['evidenceHash'] = evidence_hash(candidate)
    review = reviews.get(f"{candidate['unit']}/{candidate['exercise']}")
    if review and review.get('evidenceHash') == candidate['evidenceHash']:
        candidate['review'] = review
    return candidate


def inspect_lesson(unit, lesson):
    candidates = []
    for exercise in lesson.get('exercises', []):
        prompt = exercise.get('prompt', '')
        if not isinstance(prompt, str):
            continue
        matches = sorted({m[0] for pattern in PATTERNS for m in pattern.finditer(prompt)})
        if matches:
            candidates.append({'unit': unit, 'exercise': exercise.get('id'),
                'lessonTitle': lesson.get('title'), 'matches': matches, 'prompt': prompt,
                'context': exercise.get('context', ''), 'answers': exercise.get('answers', []),
                'hint': exercise.get('hint', ''), 'explanation': exercise.get('explanation', '')})
    return candidates


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lessons', type=Path, default=APP/'content/book-lessons')
    parser.add_argument('--output', type=Path, default=APP/'data/book-required-sources-audit.json')
    parser.add_argument('--reviews', type=Path, default=APP/'data/book-required-sources-review.json')
    args = parser.parse_args()
    candidates, errors = [], []
    files = sorted(args.lessons.glob('*.json'))
    reviews = json.loads(args.reviews.read_text(encoding='utf-8')) if args.reviews.exists() else {}
    for path in files:
        try:
            candidates += [attach_review(c, reviews) for c in inspect_lesson(path.stem, json.loads(path.read_text(encoding='utf-8')))]
        except (OSError, ValueError, TypeError, AttributeError) as error:
            errors.append({'unit': path.stem, 'error': type(error).__name__})
    atomic_json(args.output, {'at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'files': len(files), 'candidateCount': len(candidates), 'candidates': candidates,
        'unreviewed': sum('review' not in c for c in candidates),
        'errors': errors, 'conclusion': 'Candidates require contextual review; regex does not prove all lessons self-contained.'})
    print(json.dumps({'files': len(files), 'candidates': len(candidates), 'unreviewed': sum('review' not in c for c in candidates), 'errors': len(errors)}))
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())

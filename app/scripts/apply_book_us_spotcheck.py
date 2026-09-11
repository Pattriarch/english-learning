"""Apply reviewed field-level US corrections and republish the complete book release.

Default: validate the correction plan without writing. --apply changes only the
listed prepared lessons, with local backups and rollback if release checks fail.
Original PDFs, OCR sources, page images and learner progress are never edited.
"""
from __future__ import annotations
import argparse
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

from build_book_lessons import validate_lesson
from publish_book_release import atomic_json, build_release

APP = Path(__file__).resolve().parents[1]


def write_bytes(path, value):
    fd, temporary = tempfile.mkstemp(prefix=path.stem + '-', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def prepare(app=APP):
    plan = json.loads((app / 'content/book-us-spotcheck-corrections.json').read_text(encoding='utf-8-sig'))
    if plan.get('version') != 1 or plan.get('id') != '2026-09-10-book-us-spotcheck':
        raise ValueError('Unsupported correction plan')
    originals, lessons, seen = {}, {}, set()
    for change in plan['changes']:
        lesson_id, keys = change['lessonId'], change['path']
        if not re.fullmatch(r'book-[a-z0-9-]+-\d{3}', lesson_id) or not keys or keys[0] not in {'formula', 'sections', 'examples', 'exercises'}:
            raise ValueError('Correction cannot change identity or source provenance')
        marker = (lesson_id, tuple(keys))
        if marker in seen:
            raise ValueError('Duplicate correction field: ' + lesson_id)
        seen.add(marker)
        path = app / 'content/book-lessons' / (lesson_id[5:] + '.json')
        if path not in originals:
            originals[path] = path.read_bytes()
            lessons[path] = json.loads(originals[path])
            if lessons[path]['id'] != lesson_id:
                raise ValueError('Lesson identity mismatch')
        target = lessons[path]
        for key in keys[:-1]:
            target = target[key]
        if target[keys[-1]] == change['after']:
            continue
        if target[keys[-1]] != change['before']:
            raise ValueError('Stale correction: ' + lesson_id + ' ' + str(keys))
        target[keys[-1]] = deepcopy(change['after'])
    pending = {}
    for path, lesson in lessons.items():
        notes = lesson.setdefault('provenance', {}).setdefault('editorialCorrections', [])
        if plan['id'] not in notes:
            notes.append(plan['id'])
        pages = [image['page'] for image in lesson['provenance'].get('sourceImages', [])]
        validate_lesson(lesson, pages or None)
        if lesson != json.loads(originals[path]):
            pending[path] = lesson
    return plan, originals, pending


def apply(app=APP):
    plan, originals, pending = prepare(app)
    if not pending:
        return {'changedLessons': 0, 'alreadyApplied': True}
    backup = app / 'data/book-us-spotcheck-before'
    backup.mkdir(parents=True, exist_ok=True)
    metadata = {app / 'content' / name: (app / 'content' / name).read_bytes() if (app / 'content' / name).exists() else None
                for name in ['book-release.json', 'book-us-spotcheck-release.json']}
    written = []
    try:
        for path, lesson in pending.items():
            original_sha = hashlib.sha256(originals[path]).hexdigest()
            archived = backup / (path.stem + '-' + original_sha + '.json')
            if not archived.exists():
                archived.write_bytes(originals[path])
            atomic_json(path, lesson)
            written.append(path)
        release, rejected = build_release(app / 'content', app / 'data/parsed-books', app / 'data/book-page-images')
        if rejected or release['ready'] != release['total']:
            raise ValueError('Complete book release did not pass: ' + json.dumps(rejected, ensure_ascii=False))
        receipt = {'id': plan['id'], 'changedLessons': len(pending), 'ready': release['ready'], 'total': release['total'], 'files': [
            {'path': path.relative_to(app).as_posix(), 'beforeSHA256': hashlib.sha256(originals[path]).hexdigest(), 'afterSHA256': hashlib.sha256(path.read_bytes()).hexdigest()}
            for path in pending]}
        atomic_json(app / 'content/book-release.json', release)
        atomic_json(app / 'content/book-us-spotcheck-release.json', receipt)
        return {key: value for key, value in receipt.items() if key != 'files'}
    except Exception:
        for path in written:
            write_bytes(path, originals[path])
        for path, original in metadata.items():
            if original is not None:
                write_bytes(path, original)
            elif path.exists():
                path.unlink()
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if args.apply:
        result = apply()
    else:
        plan, _, pending = prepare()
        result = {'id': plan['id'], 'plannedFields': len(plan['changes']), 'changedLessons': len(pending), 'written': False}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()

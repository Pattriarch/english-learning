"""Publish fully reviewed coursebooks; preserve PDFs, learner data and old units.

Default --check validates all 59 chapters without writing. --publish requires
every chapter in the six-book intake to have matching source and review receipts.
Only original lesson adaptations and catalog metadata enter version control.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import tempfile

import generate_new_coursebooks as pipeline
from build_context_lexicon import atomic_json, file_sha
from book_source_contract import valid_pdf_name, unit_pages

APP = Path(__file__).resolve().parents[1]


def reviewed_chapters(manifest=pipeline.MANIFEST, source_root=pipeline.SOURCE_ROOT,
                      work=pipeline.WORK, audio_registry=None):
    inventory = pipeline.load_inventory(manifest, source_root)
    ready, missing = [], []
    for book, unit in inventory:
        bundle = pipeline.load_bundle(book, unit, source_root, manifest, audio_registry)
        folder = Path(work) / 'units' / unit['id'] / bundle['sourceSetSha256']
        path = folder / 'verified.json'
        if not path.exists():
            missing.append(unit['id'])
            continue
        receipt = pipeline.read(path)
        pipeline.verify_ready(receipt, bundle, folder)
        ready.append({'book': book, 'unit': unit, 'bundle': bundle,
                      'receipt': receipt, 'folder': folder})
    return ready, missing


def validate_published_coursebook(lesson, work=None):
    """Release publisher checks original semantic evidence, not a task count."""
    identifier = lesson.get('provenance', {}).get('unitId', '')
    if not pipeline.template.SAFE_ID.fullmatch(identifier):
        raise ValueError('Invalid new coursebook unit')
    work = Path(work or APP / 'data/new-coursebook-lessons')
    matches = []
    for path in (work / 'units' / identifier).glob('*/verified.json'):
        receipt = pipeline.read(path)
        if receipt.get('lesson') != lesson:
            continue
        bundle = pipeline.current_bundle(pipeline.read(path.parent / 'source-bundle.json'))
        pipeline.verify_ready(receipt, bundle, path.parent)
        matches.append(receipt)
    if not matches:
        raise ValueError('No matching independently reviewed full-chapter receipt')


def merged_catalog(existing, ready):
    result = deepcopy(existing)
    grouped = {}
    for record in ready:
        grouped.setdefault(record['book']['id'], []).append(record)
    old_ids = {book['id']: book for book in result['books']}
    for book_id, records in grouped.items():
        records.sort(key=lambda record: record['unit']['unit'])
        book = records[0]['book']
        if len(records) != book['unitCount'] or {r['unit']['id'] for r in records} != {u['id'] for u in book['units']}:
            raise ValueError('A coursebook is incomplete: ' + book_id)
        if not valid_pdf_name(book['filename']):
            raise ValueError('Unsafe supplied coursebook filename')
        units = []
        for record in records:
            unit, chapter = record['unit'], record['bundle']['chapter']
            unit_pages(unit)  # Full contiguous chapter, never just its endpoints.
            units.append({key: deepcopy(unit[key]) for key in
                          ['id', 'unit', 'title', 'page', 'endPage', 'pages', 'printedPage'] if key in unit})
            units[-1].update({'titleRu': record['receipt']['lesson']['title'],
                             'verified': True, 'category': chapter['family']})
        item = {key: deepcopy(book[key]) for key in
                ['id', 'title', 'filename', 'tocPages', 'pdfPageCount', 'unitCount']}
        item.update({'author': book.get('author', ''), 'level': records[0]['bundle']['chapter']['level'],
                     'verified': True, 'source': 'supplied-coursebook-full-page-review',
                     'notes': 'Все главы адаптированы целиком с отдельной проверкой источника и урока. '
                              'Страницы, ключи и записи остаются локально. Уровень — ориентир требований '
                              'к самостоятельному ответу, а не результат тестирования.', 'units': units})
        if book_id in old_ids:
            if old_ids[book_id] != item:
                raise ValueError('Existing coursebook catalog differs; review the migration: ' + book_id)
        else:
            result['books'].append(item)
    result.update({'auditedAt': datetime.now(timezone.utc).date().isoformat(),
                   'scope': 'Все нумерованные главы исходных учебников и шести дополнительных Student Books. '
                            'Приложения и ключи учтены как вспомогательные источники.'})
    result['totalBooks'] = len(result['books'])
    result['uniqueBooks'] = sum(not b.get('duplicateOf') for b in result['books'])
    result['totalUnits'] = sum(len(b['units']) for b in result['books'])
    result['uniqueUnits'] = sum(len(b['units']) for b in result['books'] if not b.get('duplicateOf'))
    return result


def copy_verified_image(source, destination, expected):
    source, destination = Path(source), Path(destination)
    if file_sha(source) != expected:
        raise ValueError('Source image changed before publication')
    if destination.exists():
        if file_sha(destination) != expected:
            raise ValueError('Existing canonical source image differs: ' + str(destination))
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='coursebook-page-', suffix='.tmp', dir=destination.parent)
    os.close(fd)
    try:
        shutil.copyfile(source, tmp)
        if file_sha(Path(tmp)) != expected:
            raise ValueError('Copied image differs')
        os.replace(tmp, destination)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def publish(ready, missing, content=APP / 'content', work=pipeline.WORK):
    if missing:
        raise ValueError(f'{len(missing)} chapters still await complete reviewed lessons')
    content = Path(content)
    catalog_path = content / 'library.json'
    original_catalog = catalog_path.read_bytes()
    original = json.loads(original_catalog)
    catalog = merged_catalog(original, ready)
    sources, images = content.parent / 'data/parsed-books', content.parent / 'data/book-page-images'
    # Validate the complete set before writing any public lesson or catalog.
    for record in ready:
        pipeline.verify_ready(record['receipt'], record['bundle'], record['folder'])
        if record['bundle']['source']['source'] not in {'ocr', 'text-layer-layout'}:
            raise ValueError('Unrecognized private extraction method')
        path = content / 'book-lessons' / (record['unit']['id'] + '.json')
        if path.exists() and pipeline.read(path) != record['receipt']['lesson']:
            raise ValueError('Refusing to replace a different published lesson: ' + path.stem)
    for record in ready:
        bundle, lesson = record['bundle'], record['receipt']['lesson']
        for image in bundle['attachments']:
            if image['role'] == 'chapter':
                copy_verified_image(image['path'], images / image['bookId'] / f"{image['page']}.jpg", image['sha256'])
        source = {key: deepcopy(bundle['source'][key]) for key in
                  ['unitId', 'bookId', 'pages', 'text', 'source', 'pageTexts']}
        atomic_json(sources / (record['unit']['id'] + '.json'), source)
        atomic_json(content / 'book-lessons' / (record['unit']['id'] + '.json'), lesson)
    if catalog_path.read_bytes() != original_catalog:
        raise ValueError('Catalog changed during publication; review before retrying')
    atomic_json(catalog_path, catalog)
    from publish_book_release import build_release
    release, rejected = build_release(content, sources, images, coursebook_work=work)
    if rejected or release['ready'] != release['total']:
        # Keep staged adaptations for diagnosis, restore the original catalog.
        # No learner state or original source files were changed.
        atomic_json(catalog_path, original)
        raise ValueError('Combined book release failed verification: ' + json.dumps(rejected))
    atomic_json(content / 'book-release.json', release)
    return {'newChapters': len(ready), 'ready': release['ready'], 'total': release['total']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--publish', action='store_true')
    parser.add_argument('--audio-registry', type=Path)
    args = parser.parse_args()
    ready, missing = reviewed_chapters(audio_registry=args.audio_registry)
    summary = {'reviewed': len(ready), 'missing': len(missing), 'complete': not missing}
    if args.publish:
        summary.update(publish(ready, missing))
    print(json.dumps(summary), flush=True)
    return int(bool(missing))


if __name__ == '__main__':
    raise SystemExit(main())

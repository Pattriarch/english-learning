"""Render every canonical unit for image-assisted textbook interpretation.

Uses the clean equivalent ebook for Murphy, preserving the canonical page IDs.
No page selection depends on generated content. Resumable, atomic JPEG output.
"""
import concurrent.futures
import json
import os
from pathlib import Path
import pymupdf

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / 'app'
OUTPUT = APP / 'data/book-page-images'

def render_book(book):
    if book.get('duplicateOf'):
        return {'bookId': book['id'], 'duplicate': True, 'pages': 0}
    docs = {}
    count = 0
    out = OUTPUT / book['id']
    out.mkdir(parents=True, exist_ok=True)
    try:
        for unit in book['units']:
            source = json.loads((APP / 'data/parsed-books' / (unit['id']+'.json')).read_text(encoding='utf-8'))
            provenance = source.get('provenance', {})
            filename = provenance.get('textFilename', book['filename'])
            if filename not in docs:
                docs[filename] = pymupdf.open(ROOT / 'книги' / filename)
            document = docs[filename]
            for page in source['pageTexts']:
                target = out / (str(page['page']) + '.jpg')
                if target.exists() and target.stat().st_size > 5000:
                    count += 1
                    continue
                source_page = page.get('sourcePage', page['page'])
                pix = document[source_page-1].get_pixmap(dpi=160, alpha=False)
                temp = target.with_suffix('.tmp.jpg')
                temp.write_bytes(pix.tobytes('jpg', jpg_quality=91))
                os.replace(temp, target)
                count += 1
        print(f"READY {book['id']}: {count} pages", flush=True)
        return {'bookId': book['id'], 'pages': count}
    finally:
        for document in docs.values():
            document.close()

if __name__ == '__main__':
    catalog = json.loads((APP / 'content/library.json').read_text(encoding='utf-8'))
    books = sorted(catalog['books'], key=lambda b:b['id']!='grammar-intermediate')
    # PDF document objects never cross process boundaries.
    with concurrent.futures.ProcessPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(render_book, books))
    report = {'dpi':160,'format':'jpg','books':results,'pages':sum(b['pages'] for b in results)}
    (APP/'data/book-page-images-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=True),flush=True)

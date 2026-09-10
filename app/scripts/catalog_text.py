"""Create the PRIVATE unit reader cache from the user's own PDFs.

Output is in app/data/, already ignored by Git. No book text goes into the
public catalog. Scanned books remain explicitly marked as scanned.
"""
from pathlib import Path
import json
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
catalog = json.loads((ROOT/'app/content/library.json').read_text(encoding='utf8'))
out = ROOT/'app/data/library-text.json'
out.parent.mkdir(parents=True,exist_ok=True)
cache={}
for book in catalog['books']:
    reader = PdfReader(ROOT/'книги'/book['filename'])
    scanned = book['source']=='ocr-and-visual-toc'
    for unit in book['units']:
        text = '' if scanned else '\n\n'.join((reader.pages[p-1].extract_text() or '') for p in range(unit['page'],unit['endPage']+1))
        cache[unit['id']] = {
            'text':text, 'pages':[unit['page'],unit['endPage']],
            'source':'scanned' if scanned else 'text-layer',
            'bookId':book['id'],'title':unit['title'],
        }
    print(book['id'],book['unitCount'],'scanned' if scanned else 'text-layer',flush=True)
temp=out.with_suffix('.tmp')
temp.write_text(json.dumps(cache,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf8')
temp.replace(out)
print('Wrote',len(cache),'unit records;',out.stat().st_size,'bytes',flush=True)

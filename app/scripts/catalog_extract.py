"""Extract the supplied books' first pages for a reproducible TOC audit."""
from pathlib import Path
import json
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'app/content/toc/catalog-pages'
OUT.mkdir(parents=True, exist_ok=True)
manifest = []
TOC_PAGES = {1:[5,6],2:[5,6],3:[5,6],4:[],5:[],6:[4,5,6,7],7:[],8:[],9:[5,6],10:[4,5],11:[4,5]}
for index, path in enumerate(sorted((ROOT / 'книги').glob('*.pdf'))):
    reader = PdfReader(path)
    pages = []
    for number, page in enumerate(reader.pages[:10], 1):
        text = page.extract_text() or ''
        pages.append({'page': number, 'text': text})
    filename = f'{index+1:02d}.json'
    (OUT / filename).write_text(json.dumps([p for p in pages if p['page'] in TOC_PAGES[index+1]], ensure_ascii=False, indent=2), encoding='utf-8')
    manifest.append({'file': filename, 'filename': path.name, 'pages':len(reader.pages), 'textLengths':[len(p['text']) for p in pages]})
(OUT / 'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(manifest,ensure_ascii=False,indent=2))

"""Render only unit title strips for page-position verification of scans."""
from pathlib import Path
import json
import pypdfium2 as pdfium

ROOT=Path(__file__).resolve().parents[2]
catalog=json.loads((ROOT/'app/content/library.json').read_text(encoding='utf8'))
out=ROOT/'app/data/catalog-verify'
out.mkdir(parents=True,exist_ok=True)
for book in catalog['books']:
    if book['source']!='ocr-and-visual-toc':
        continue
    doc=pdfium.PdfDocument(str(ROOT/'книги'/book['filename']))
    for unit in book['units']:
        page=doc[unit['page']-1]
        im=page.render(scale=1.5).to_pil()
        im.crop((0,0,im.width,round(im.height*.17))).save(out/(unit['id']+'.png'))
    print(book['id'],book['unitCount'],flush=True)

"""Save short page headers, used only to locate units in supplied local PDFs."""
from pathlib import Path
import json
from pypdf import PdfReader
ROOT = Path(__file__).resolve().parents[2]
out = ROOT / 'app/data/catalog-verify'
out.mkdir(parents=True,exist_ok=True)
result = {}
for i, path in enumerate(sorted((ROOT / 'книги').glob('*.pdf')), 1):
    if i in (4,5):
        continue
    r = PdfReader(path)
    headers = [{'page':p+1,'text':(v.extract_text() or '')[:450]} for p,v in enumerate(r.pages)]
    (out / f'headers-{i:02d}.json').write_text(json.dumps(headers,ensure_ascii=False,indent=2),encoding='utf8')
    print(i,path.name,len(headers))

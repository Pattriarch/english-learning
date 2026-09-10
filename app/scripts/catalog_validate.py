"""Validate unit coverage and actual PDF page starts against extracted content."""
from pathlib import Path
from collections import Counter
import json, re

ROOT=Path(__file__).resolve().parents[2]
catalog=json.loads((ROOT/'app/content/library.json').read_text(encoding='utf8'))
text=json.loads((ROOT/'app/data/library-text.json').read_text(encoding='utf8'))
ocr=json.loads((ROOT/'app/data/catalog-verify/headers.json').read_text(encoding='utf-8-sig'))
norm=lambda s: re.sub('[^a-z0-9]','',s.lower())
def shingles(s):
    tokens=re.findall('[a-z]+',s.lower())
    return set(zip(tokens,tokens[1:],tokens[2:]))
def similarity(a,b):
    return len(a&b)/max(1,len(a|b))

# The six title strips were opened and visually checked after OCR mismatches.
# Unit70: TOC says "Adjectives", actual heading uses singular "Adjective".
visually_checked={
    'grammar-advanced-023','grammar-advanced-070','grammar-advanced-076',
    'grammar-advanced-083','grammar-advanced-096','grammar-advanced-097',
}
# PDF text reading order splits these multi-line headings around a number/label.
layout_checked={
    'grammar-elementary-102',
    'vocabulary-upper-intermediate-085',
}
report=[]
fingerprints={}
for book in catalog['books']:
    assert [u['unit'] for u in book['units']]==list(range(1,book['unitCount']+1))
    for u in book['units']:
        if book['id'] in ('grammar-intermediate','grammar-intermediate-ebook'):
            fingerprints[u['id']]=shingles(text[u['id']]['text'])
for book in catalog['books']:
    for u in book['units']:
        entry={'id':u['id'],'page':u['page'],'endPage':u['endPage']}
        assert text[u['id']]['pages']==[u['page'],u['endPage']]
        if book['id']=='grammar-intermediate':
            # The2012 PDF text layer omits its dark title bars. Match each entire
            # two-page unit against the same-unit ebook and both neighbours.
            own=fingerprints[u['id']]
            candidates=range(max(1,u['unit']-1),min(145,u['unit']+1)+1)
            scores={i:similarity(own,fingerprints[f'grammar-intermediate-ebook-{i:03d}']) for i in candidates}
            best=max(scores,key=scores.get)
            assert best==u['unit'] and scores[best]>.32,(u['id'],scores)
            entry.update(method='same-unit-ebook-content-match',similarity=round(scores[best],3))
        elif book['source']=='ocr-and-visual-toc':
            if norm(u['title']) in norm(ocr[u['id']]):
                entry['method']='ocr-title-match'
            else:
                assert u['id'] in visually_checked,u['id']
                entry['method']='visual-title-verification'
        elif norm(u['title']) in norm(text[u['id']]['text']):
            entry['method']='text-title-match'
        else:
            assert u['id'] in layout_checked,u['id']
            entry['method']='text-layout-verification'
        report.append(entry)
assert len(report)==catalog['totalUnits']==1017
assert len(set(e['id'] for e in report))==1017
result={'auditedAt':'2026-09-09','totalVerifiedUnitPages':len(report),'methods':dict(Counter(e['method'] for e in report)),'units':report}
(ROOT/'app/content/toc/catalog-page-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps(result['methods'],indent=2))
print('Minimum Murphy content-match score:',min(e['similarity'] for e in report if 'similarity' in e))
print('All1017 unit starts verified.')

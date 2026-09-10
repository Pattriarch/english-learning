"""Apply explicitly page-reviewed dictionary corrections to PRIVATE source data.

No OCR/model is run. A review sheet contains visually checked headwords, source
unit references and exact OCR corrections. Missing pages never become verified.
"""
from __future__ import annotations
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

from build_book_lessons import atomic_json

APP = Path(__file__).resolve().parents[1]
IDENTIFIER = 'phrasal-intermediate-appendix-01'
SOURCE = APP / 'data/parsed-book-supplements' / (IDENTIFIER+'.json')
REVIEW = APP / 'data/phrasal-dictionary-review.json'
IMAGES = APP / 'data/parsed-book-supplements-ocr-work/phrasal-intermediate'


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1 << 20),b''):
            h.update(chunk)
    return h.hexdigest()


def flatten(text):
    return re.sub(r'\s+',' ',text).strip()


def entries_for_column(text, records, page, column):
    text = flatten(text)
    cursor = 0
    entries = []
    for i, record in enumerate(records):
        headword, units = record[:2]
        cross_reference = record[2].get('crossReference') if len(record)>2 else None
        suffix_reference = record[2].get('suffixReference') if len(record)>2 else None
        if (not units and not cross_reference) or any(not isinstance(u,int) or not 1 <= u <= 70 for u in units):
            raise ValueError(f'{page}/{column}: invalid checked unit references')
        unit_pattern = r'\s*,\s*'.join(str(u) for u in units)
        boundary = (r'(?=\s+' + re.escape(records[i+1][0]) + r'\s)' if i+1<len(records) else r'\s*$')
        pattern = (re.escape(headword) + r'\s+(?P<definition>see\s+'+re.escape(cross_reference)+r')'+boundary
                   if cross_reference else
                   re.escape(headword) + r'\s+(?P<definition>.*?)\s+(?P<units>'+unit_pattern+r')\.?'
                   + (r'\s+see\s+'+re.escape(suffix_reference) if suffix_reference else '') + boundary)
        match = re.match(pattern,text[cursor:])
        if not match:
            raise ValueError(f'{page}/{column}: cannot segment checked entry {headword!r} at {text[cursor:cursor+120]!r}')
        definition = match.group('definition').strip()
        if len(definition)<5:
            raise ValueError(f'{page}/{column}: definition missing for {headword}')
        part_of_speech = 'verb'
        pos = re.match(r'^(n|adj|adv)\s+',definition)
        if pos:
            part_of_speech = {'n':'noun','adj':'adjective','adv':'adverb'}[pos[1]]
        canonical_headword = re.sub(r'\s*([/-])\s*', r'\1', headword)
        entry = {'id':f'{IDENTIFIER}-p{page}-c{column}-e{i+1}',
                 'headword':canonical_headword,'sourceHeadword':headword,'definition':definition,'partOfSpeech':part_of_speech,
                 'unitReferences':units,'unitIds':[f'phrasal-intermediate-{u:03}' for u in units],
                 'page':page,'column':column,'sourceText':match[0].strip(),
                 'manuallyReviewed':True}
        if cross_reference:
            entry['crossReference'] = cross_reference
        if suffix_reference:
            entry['crossReference'] = suffix_reference
        entries.append(entry)
        cursor += match.end()
        while cursor<len(text) and text[cursor].isspace():
            cursor+=1
    if cursor!=len(text):
        raise ValueError(f'{page}/{column}: unassigned dictionary text')
    return entries


def apply_review(source, reviewed):
    result = deepcopy(source)
    result.setdefault('preReviewText',source['text'])
    checked = []
    count = 0
    for page in result['pageTexts']:
        number = page['page']
        spec = reviewed.get(str(number))
        if not spec:
            continue
        original_columns = page.get('preReviewColumnTexts',page['columnTexts'])
        if not 1 <= len(original_columns) <= 3 or len(spec.get('columns',[]))!=len(original_columns) or not spec.get('observations'):
            raise ValueError(f'{number}: every actual source column and visual observations required')
        page.setdefault('preReviewText',page['text'])
        page.setdefault('preReviewColumnTexts',deepcopy(page['columnTexts']))
        corrected_text = page['preReviewText']
        columns = deepcopy(page['preReviewColumnTexts'])
        corrections = []
        for before, after in spec.get('corrections',[]):
            occurrences = corrected_text.count(before)
            if not occurrences:
                raise ValueError(f'{number}: correction not found in original text: {before!r}')
            corrected_text = corrected_text.replace(before,after)
            for column in columns:
                column['text'] = column['text'].replace(before,after)
            corrections.append({'before':before,'after':after,'occurrences':occurrences,'method':'visually checked against source page'})
        entries = []
        for exclusion in spec.get('nonEntryText',[]):
            column = columns[exclusion['column']-1]
            suffix = exclusion['text']
            if not exclusion.get('reason') or not column['text'].endswith(suffix):
                raise ValueError(f'{number}: non-entry footer does not match source')
            column['text'] = column['text'][:-len(suffix)].rstrip()
        received_continuations = []
        for other_number, other_spec in reviewed.items():
            for move in other_spec.get('continuations',[]):
                if move.get('fromPage') == number and int(other_number) != number:
                    origin = columns[move['fromColumn']-1]
                    if not origin['text'].startswith(move['text']):
                        raise ValueError(f'{number}: page continuation does not match source')
                    origin['text'] = origin['text'][len(move['text']):].lstrip()
                    received_continuations.append({**move,'toPage':int(other_number)})
        for move in spec.get('continuations',[]):
            if move.get('fromPage',number)!=number:
                from_page = move['fromPage']
                if str(from_page) not in reviewed:
                    raise ValueError(f'{number}: continuation page must also be visually reviewed')
                original_page = next(p for p in source['pageTexts'] if p['page']==from_page)
                original_columns = deepcopy(original_page.get('preReviewColumnTexts',original_page['columnTexts']))
                origin = original_columns[move['fromColumn']-1]
                for before,after in reviewed[str(from_page)].get('corrections',[]):
                    origin['text'] = origin['text'].replace(before,after)
            else:
                origin = columns[move['fromColumn']-1]
            destination = columns[move['toColumn']-1]
            prefix = move['text']
            if not origin['text'].startswith(prefix):
                raise ValueError(f'{number}: continuation does not match source column')
            destination['text'] += '\n'+prefix
            origin['text'] = origin['text'][len(prefix):].lstrip()
        for column, records in zip(columns,spec['columns']):
            entries += entries_for_column(column['text'],records,number,column['column'])
        for annotation_key in ('sourceIssues', 'sourceNotes'):
            for issue in spec.get(annotation_key, []):
                matches = [entry for entry in entries if entry['sourceHeadword'] == issue['headword']
                           and entry['unitReferences'] == issue['unitReferences']]
                if len(matches) != 1 or not issue.get('note'):
                    raise ValueError(f'{number}: source annotation must identify exactly one checked entry')
                matches[0][annotation_key] = [deepcopy(issue)]
                if annotation_key == 'sourceIssues':
                    matches[0]['teachingUse'] = 'requires-editorial-adaptation'
        page.update(text=corrected_text,columnTexts=columns,dictionaryEntries=entries,corrections=corrections)
        page['sourceIssues'] = deepcopy(spec.get('sourceIssues', []))
        page['sourceNotes'] = deepcopy(spec.get('sourceNotes', []))
        page['layoutCorrections'] = deepcopy(spec.get('continuations',[]))
        page['continuedFromPreviousPages'] = received_continuations
        page['nonEntryText'] = deepcopy(spec.get('nonEntryText',[]))
        for move in page['layoutCorrections']:
            last_entry = [entry for entry in entries if entry['column']==move['toColumn']][-1]
            last_entry['continuedInColumn'] = move['fromColumn']
            if move.get('fromPage'):
                last_entry['continuedInPage'] = move['fromPage']
        page['verification']={'visualVerified':True,'manuallyReviewed':True,'allTextVerified':True,
                              'entryCount':len(entries),'observations':spec['observations'],
                              'renderSHA256':sha(IMAGES/f'page-{number}.png')}
        checked.append(number)
        count+=len(entries)
    result['text']='\n\n'.join(page['text'].strip() for page in result['pageTexts'])
    expected=list(range(result['pages'][0],result['pages'][1]+1))
    complete=checked==expected
    result['quality'].update(characterCount=len(result['text']),visualVerified=complete,manuallyReviewed=complete,
                             status='extracted' if complete else 'needs-source-check')
    result['quality']['confidenceNote'] = (
        'All 24 dictionary pages were visually checked column by column, including every headword, definition and unit reference. Numeric OCR confidence is unavailable; printed-source issues are recorded separately.'
        if complete else
        f'{len(checked)} of 24 dictionary pages explicitly visually checked in this review. Numeric OCR confidence is unavailable; remaining pages still require verification.')
    result['quality']['verification']={'pdfPages':checked,'allTextVerified':complete,'dictionaryEntries':count,
                                      'sourceIssueCount':sum(len(p.get('sourceIssues',[])) for p in result['pageTexts']),
                                      'sourceNoteCount':sum(len(p.get('sourceNotes',[])) for p in result['pageTexts']),
                                      'method':'Every recorded headword, variant, definition and unit reference checked visually, column by column; unrecorded pages remain unverified.',
                                      'remainingPages':[p for p in expected if p not in checked]}
    result['provenance']['reviewSourceSHA256']=sha(APP.parent/result['provenance']['sourcePath'])
    result['provenance']['reviewedAt']=datetime.now(timezone.utc).isoformat(timespec='seconds')
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    original=read(SOURCE)
    updated=apply_review(original,read(REVIEW))
    if args.apply:
        atomic_json(SOURCE,updated)
    print(json.dumps({'written':args.apply,**updated['quality']['verification']},ensure_ascii=True))


if __name__=='__main__':
    main()

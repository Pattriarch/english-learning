"""Reviewed US house-style migration for authored courses, never book lessons.

Default is a read-only proposal. --apply saves immutable backups and field-level
receipts, validates the complete extended course, then uses its normal publisher.
No model, audio, network, server or learner-progress operations.
"""
from __future__ import annotations
import argparse
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

from build_book_lessons import atomic_json
from build_extended_course import APP, digest, validate, validate_plan
from finalize_extended_course import finalize

MIGRATION = '2026-09-10-authored-american-house-style'
REASON = 'American English в авторских формулировках; British-сцены, названия и сравнения сохранены. Миграция 2026-09-10.'
COURSES = ['curriculum.json', 'courses/advanced.json', 'courses/cinema-lessons.json',
           'courses/extended-skills.json', 'courses/foundation.json', 'courses/research-expansion.json']
# Explicit British learning situations. Sterling scenarios are also protected.
PROTECTED_LESSONS = {
    'extended-a1-notices': 'The lesson explicitly teaches British floor numbering.',
    'extended-c2-editor': 'The supplied house style explicitly requires British -ise.',
    'extended-c1-conversion': 'British committee usage is part of the table/table contrast.',
    'extended-b2-reference-letter': 'The theory explicitly identifies a British workplace situation.',
}
COMPARISON = re.compile(r'\b(?:British|Britain|BrE|AmE)\b|британ|американ', re.I)
PROPER_NAMES = re.compile(r'\b(?:Neighbour Link|River Centre|Greenbridge Language Centre|Oak Centre|Bracken Centre|Harbour Rooms|Harbour Voices Archive|Archive Training Programme)\b')
SPELLING = {}
for british, american, suffixes in [
    ('colour','color',['','s','ed','ing','ful','less']),
    ('favour','favor',['','s','ed','ing','able','ably','ite','ites']),
    ('neighbour','neighbor',['','s','ing','hood','hoods']),
    ('behaviour','behavior',['','s','al']),('labour','labor',['','s']),
    ('humour','humor',['','s']),('honour','honor',['','s','ed','ing']),
    ('flavour','flavor',['','s']),('rumour','rumor',['','s']),
    ('centre','center',['','s','d']),('metre','meter',['','s']),
    ('litre','liter',['','s']),('theatre','theater',['','s']),
    ('fibre','fiber',['','s']),('programme','program',['','s']),
    ('centimetre','centimeter',['','s']),('millimetre','millimeter',['','s']),
    ('kilometre','kilometer',['','s']),('catalogue','catalog',['','s']),
]:
    for suffix in suffixes: SPELLING[british+suffix] = american+suffix
for stem in ['organ','recogn','real','priorit','custom','minim','maxim','apolog',
             'summar','emphas','normal','critic','mobil','stabil','author','item',
             'digit','synthes','character','final','energ','general','focal','nominal','util']:
    for suffix in ['e','es','ed','ing','er','ers','ation','ations']:
        SPELLING[stem+'is'+suffix] = stem+'iz'+suffix
for before, after in [
    ('practise','practice'),('practises','practices'),('practised','practiced'),('practising','practicing'),
    ('analyse','analyze'),('analyses','analyzes'),('analysed','analyzed'),('analysing','analyzing'),
    ('travelling','traveling'),('travelled','traveled'),('traveller','traveler'),('travellers','travelers'),
    ('cancelled','canceled'),('cancelling','canceling'),('labelled','labeled'),('labelling','labeling'),
    ('modelled','modeled'),('modelling','modeling'),('fulfil','fulfill'),('fulfilment','fulfillment'),
    ('enrolment','enrollment'),('licence','license'),('licences','licenses'),('judgement','judgment'),('centred','centered'),
    ('judgements','judgments'),('levelled','leveled'),
]: SPELLING[before] = after
# Analyses is normally the plural noun, not a spelling error. No automatic change.
SPELLING.pop('analyses',None)
WORD = re.compile(r'[A-Za-z]+')

# Reviewed senses and lesson contexts; there is deliberately no global lift/flat rule.
APARTMENT_LESSONS = {
    'path-idioms-context','cinema-bcs-s01e02-prepare','cinema-bcs-s01e07-prepare',
    'extended-a2-story','extended-b2-interview','path-present-continuous','path-there-is',
    'path-possession','path-past-simple','path-future-simple','path-future-plans',
    'path-comparatives','path-gerund-infinitive','path-past-perfect',
    'path-future-continuous','research-listening-decoding','path-phrasal-nuance',
}
ROOMMATE_LESSONS = {'cinema-bcs-s01e02-prepare','cinema-bcs-s01e03-prepare',
                    'cinema-bcs-s01e03-respond','extended-b2-sleep'}
ELEVATOR_LESSONS = {'cinema-bcs-s01e03-listen','path-phrasal-nuance','extended-b1-procedure'}
EXACT_LEXIS = {
    'cinema-bcs-s01e03-respond': [('camera above the lift','camera above the elevator')],
    'path-past-continuous': [('turned off the cooker','turned off the stove')],
    'path-word-formation': [('turn on the cooker','turn on the stove')],
    'path-future-perfect': [('take the rubbish out','take the trash out')],
    'path-adjectives-frequency': [('at the weekend','on weekends')],
    'cinema-bcs-s01e07-prepare': [('during my holiday','during my vacation')],
    'extended-c2-literary': [('boot of her car','trunk of her car'),('waistcoat','vest')],
}

def read(path): return json.loads(path.read_text(encoding='utf-8-sig'))
def sha(raw): return hashlib.sha256(raw).hexdigest()
def walk(value, path=()):
    if isinstance(value,str): yield path,value
    elif isinstance(value,list):
        for i,child in enumerate(value): yield from walk(child,path+(i,))
    elif isinstance(value,dict):
        for key,child in value.items(): yield from walk(child,path+(key,))
def get(value,path):
    for key in path: value=value[key]
    return value
def put(value,path,text):
    for key in path[:-1]: value=value[key]
    value[path[-1]]=text
def teaching_field(path):
    if path in [('formula',),('goal',)]:return True
    return bool(path and ((path[0]=='sections' and path[-1]=='body') or
      (path[0]=='examples' and path[-1] in {'en','ru','why'}) or
      (path[0]=='materials' and path[-1]=='text') or
      (path[0]=='exercises' and (path[-1] in {'prompt','context','hint','explanation'} or 'answers' in path))))
def copy_case(source,target):
    return target.upper() if source.isupper() else target.capitalize() if source[0].isupper() else target
def spelling(text):
    protected=[(m.start(),m.end()) for m in PROPER_NAMES.finditer(text)]
    protected += [(m.start(),m.end()) for m in re.finditer(r'https?://\S+',text)]
    def replace(match):
        word=match.group();key=word.lower()
        if any(start<=match.start()<end for start,end in protected):return word
        # Capitalized Centre belongs to institution names in the audited corpus.
        if word=='Centre':return word
        return copy_case(word,SPELLING[key]) if key in SPELLING else word
    return WORD.sub(replace,text)
def transform(lesson_id,text):
    if COMPARISON.search(text) or re.search(r'\bpounds?\b',text,re.I):return text
    out=spelling(text)
    if lesson_id in APARTMENT_LESSONS:
        out=re.sub(r'\bflats?\b',lambda m:copy_case(m.group(),'apartments' if m.group().lower()=='flats' else 'apartment'),out,flags=re.I)
    if lesson_id in ROOMMATE_LESSONS:out=re.sub(r'\bflatmate\b',lambda m:copy_case(m.group(),'roommate'),out,flags=re.I)
    if lesson_id in ELEVATOR_LESSONS:out=re.sub(r'\blift\b',lambda m:copy_case(m.group(),'elevator'),out,flags=re.I)
    for before,after in EXACT_LEXIS.get(lesson_id,[]):
        out=re.sub(r'\b'+re.escape(before)+r'\b',lambda m:copy_case(m.group(),after),out,flags=re.I)
    if lesson_id in APARTMENT_LESSONS or lesson_id in ELEVATOR_LESSONS:
        out=re.sub(r'\b([Aa]) (apartment|apartments|elevator)\b',
                   lambda m:('An' if m.group(1)=='A' else 'an')+' '+m.group(2),out)
    return out
def identity(lesson):
    return (lesson['id'],[(e['id'],e['kind'],e.get('materialIds')) for e in lesson['exercises']],
            [(m['id'],m['kind']) for m in lesson.get('materials',[])])
def update_corrections(original, before_by_id, after_by_id, receipts):
    result=deepcopy(original);covered={}
    changed={}
    for r in receipts:
        if r['file']=='courses/extended-skills.json':changed.setdefault(r['lessonId'],[]).append(tuple(r['path']))
    for row in result['corrections']:
        lid=row['lessonId']
        if lid not in changed:continue
        for change in row['changes']:
            path=tuple(change['path'])
            if any(path[:len(p)]==p or p[:len(path)]==path for p in changed[lid]):
                change['after']=deepcopy(get(after_by_id[lid],path))
                covered.setdefault(lid,[]).append(path)
    for lid,paths in changed.items():
        additions=[]
        for path in paths:
            if any(path[:len(p)]==p for p in covered.get(lid,[])):continue
            additions.append({'path':list(path),'before':get(before_by_id[lid],path),'after':get(after_by_id[lid],path)})
        if additions:result['corrections'].append({'lessonId':lid,'reason':REASON,'changes':additions})
    # All persisted corrections must accept the current post-migration object.
    for row in result['corrections']:
        for change in row['changes']:
            actual=get(after_by_id[row['lessonId']],change['path'])
            if actual!=change['after']:raise ValueError('Correction replay would conflict: '+row['lessonId']+str(change['path']))
    return result

def migrate(app=APP,apply=False):
    files={name:app/'content'/name for name in COURSES}
    originals={name:path.read_bytes() for name,path in files.items()}
    courses={name:read(path) for name,path in files.items()};before=deepcopy(courses)
    by_id={l['id']:l for lessons in courses.values() for l in lessons}
    if len(by_id)!=211:raise ValueError('Expected the audited 211 authored lessons')
    protected={};receipts=[];audio=[]
    for name,lessons in courses.items():
        for lesson in lessons:
            lid=lesson['id']
            reason=PROTECTED_LESSONS.get(lid)
            if not reason and any('£' in text for path,text in walk(lesson) if teaching_field(path)):
                reason='Sterling-denominated British practice situation; retained as written.'
            if reason:protected[lid]=reason;continue
            for path,text in list(walk(lesson)):
                if not teaching_field(path):continue
                after=transform(lid,text)
                if after!=text:
                    put(lesson,path,after)
                    receipts.append({'file':name,'lessonId':lid,'path':list(path),
                      'before':text,'after':after,'beforeSHA256':sha(text.encode()),'afterSHA256':sha(after.encode())})
                    if path[0]=='materials' and path[-1]=='text':
                        audio.append({'lessonId':lid,'materialId':lesson['materials'][path[1]]['id'],
                          'beforeTextSHA256':sha(text.encode()),'afterTextSHA256':sha(after.encode())})
                    elif path[0]=='examples' and path[-1]=='en':
                        audio.append({'lessonId':lid,'exampleIndex':path[1],'playback':'on-demand',
                          'beforeTextSHA256':sha(text.encode()),'afterTextSHA256':sha(after.encode())})
            original=next(l for l in before[name] if l['id']==lid)
            if identity(original)!=identity(lesson):raise ValueError('Lesson/task identity changed')
    plan=read(app/'content/extended-course-plan.json');validate_plan(plan)
    extended={l['id']:l for l in courses['courses/extended-skills.json']}
    for module in plan['modules']:validate(extended[module['id']],module)
    correction_path=app/'content/extended-course-corrections.json'
    correction_raw=correction_path.read_bytes()
    corrections=update_corrections(read(correction_path),
        {l['id']:l for l in before['courses/extended-skills.json']},extended,receipts)
    report={'version':1,'migrationId':MIGRATION,'applied':apply,'scannedLessons':len(by_id),
      'changedLessons':len({r['lessonId'] for r in receipts}),'changedFields':len(receipts),
      'fileCounts':dict(Counter(r['file'] for r in receipts)),
      'protectedLessons':protected,'changes':receipts,'changedAudioInputs':audio,
      'files':[{'file':name,'beforeSHA256':sha(originals[name])} for name in files]}
    folder=app/'data/american-course-migration'
    if not apply:
        atomic_json(folder/'proposal.json',report);return report
    if not receipts:raise ValueError('No changes; migration may already be applied')
    if any(path.read_bytes()!=originals[name] for name,path in files.items()) or correction_path.read_bytes()!=correction_raw:
        raise ValueError('Concurrent course edit detected before write')
    backup=folder/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup.mkdir(parents=True,exist_ok=False)
    for name,raw in originals.items():
        dest=backup/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(raw)
    (backup/'extended-course-corrections.json').write_bytes(correction_raw)
    # Current release/caches are retained for forensic comparison as well.
    (backup/'extended-course-release.json').write_bytes((app/'content/extended-course-release.json').read_bytes())
    for name,path in files.items():
        if courses[name]!=before[name]:atomic_json(path,courses[name])
    atomic_json(correction_path,corrections)
    publication=finalize(app)
    for row in report['files']:row['afterSHA256']=sha(files[row['file']].read_bytes())
    report['backup']=str(backup.relative_to(app))
    report['extendedRelease']={'moduleCount':publication['moduleCount'],'materialCount':publication['materialCount'],
      'exerciseCount':publication['exerciseCount'],'fileSHA256':sha((app/'content/extended-course-release.json').read_bytes())}
    atomic_json(folder/'receipt.json',report)
    atomic_json(app/'content/american-course-migration.json',report)
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',action='store_true')
    args=parser.parse_args();result=migrate(apply=args.apply)
    print(json.dumps({k:v for k,v in result.items() if k not in {'changes','changedAudioInputs','protectedLessons'}},ensure_ascii=False))

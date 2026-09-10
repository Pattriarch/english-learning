"""Publish the complete researched extension into the learning path.

Refuses a partial build. Existing lesson IDs and learner data are preserved.
"""
from __future__ import annotations
import argparse
from copy import deepcopy
import json
import hashlib
from pathlib import Path
import time
from build_extended_course import APP, VERSION, digest, stamp, validate, validate_plan, words
from build_book_lessons import atomic_json

def verify_figures(app,plan):
 """A prepared visual task must ship the exact chart and reviewed dataset."""
 expected=[(module,material) for module in plan['modules'] for material in module['materials'] if material.get('figure')]
 if not expected:return []
 folder=app/'studio/assets/learning-figures'
 manifest=json.loads((folder/'manifest.json').read_text(encoding='utf-8-sig'))
 if manifest.get('version')!=1:raise ValueError('Unsupported figure manifest')
 entries={entry['id']:entry for entry in manifest['figures']}
 if len(entries)!=len(manifest['figures']):raise ValueError('Duplicate figure manifest entries')
 checked=[]
 for module,material in expected:
  figure_id=material['figure']['id'];entry=entries.get(figure_id)
  if not entry or entry.get('materialId')!=material['id']:raise ValueError('Missing prepared figure: '+figure_id)
  extension=material['figure'].get('format','svg')
  if extension not in {'svg','png'} or entry.get('file')!=figure_id+'.'+extension:raise ValueError('Unexpected figure file: '+figure_id)
  dataset_file=entry.get('datasetFile','')
  if not dataset_file or Path(dataset_file).name!=dataset_file or not dataset_file.endswith('.json'):
   raise ValueError('Invalid figure dataset path: '+figure_id)
  for filename,hash_field in [(entry['file'],'sha256'),(dataset_file,'datasetSHA256')]:
   actual=hashlib.sha256((folder/filename).read_bytes()).hexdigest()
   if actual!=entry.get(hash_field):raise ValueError('Prepared figure asset changed: '+filename)
  dataset=json.loads((folder/dataset_file).read_text(encoding='utf-8-sig'))
  if dataset!=module.get('visualDataSpec'):raise ValueError('Figure dataset differs from lesson specification: '+figure_id)
  checked.append({'lessonId':module['id'],**entry})
 return checked

def editorial_corrections(app,lessons):
 path=app/'content/extended-course-corrections.json'
 if not path.exists():return lessons
 value=json.loads(path.read_text(encoding='utf-8-sig'))
 if value.get('version')!=1:raise ValueError('Unsupported editorial correction format')
 lessons=deepcopy(lessons);by_id={l['id']:l for l in lessons}
 for correction in value['corrections']:
  lesson=by_id[correction['lessonId']]
  for change in correction['changes']:
   keys=change['path']
   if not keys or keys[0] not in {'formula','sections','examples','exercises','materials'}:
    raise ValueError('Editorial correction cannot change lesson identity or provenance')
   target=lesson
   for key in keys[:-1]:target=target[key]
   if target[keys[-1]]==change['after']:continue
   if target[keys[-1]]!=change['before']:
    raise ValueError('Stale editorial correction: '+lesson['id']+' '+str(keys))
   target[keys[-1]]=change['after']
  notes=lesson.setdefault('provenance',{}).setdefault('editorialCorrections',[])
  if correction['reason'] not in notes:notes.append(correction['reason'])
 return lessons

def finalize(app=APP):
 plan=json.loads((app/'content/extended-course-plan.json').read_text(encoding='utf-8-sig'))
 validate_plan(plan)
 figures=verify_figures(app,plan)
 lessons=json.loads((app/'content/courses/extended-skills.json').read_text(encoding='utf-8-sig'))
 lessons=editorial_corrections(app,lessons)
 by_id={lesson['id']:lesson for lesson in lessons}
 if len(by_id)!=len(lessons) or set(by_id)!={m['id'] for m in plan['modules']}:
  raise ValueError('Every planned module must be fully prepared before final publication')
 rows=[]
 for module in plan['modules']:
  lesson=by_id[module['id']];validate(lesson,module)
  provenance=lesson.get('provenance',{})
  if provenance.get('specHash')!=digest(module) or provenance.get('promptVersion')!=VERSION:
   raise ValueError('Lesson does not match the current researched specification: '+module['id'])
  rows.append({'id':lesson['id'],'title':lesson['title'],'level':lesson['level'],
   'theoryWords':sum(words(s['body']) for s in lesson['sections']),
   'materialWords':sum(words(m['text']) for m in lesson['materials']),
   'materialCount':len(lesson['materials']),'exerciseCount':len(lesson['exercises']),
   'lessonSHA256':digest(lesson)})
 # No file is changed until the whole corrected course passes its original gates.
 atomic_json(app/'content/courses/extended-skills.json',lessons)
 for lesson in lessons:atomic_json(app/'data/extended-lessons'/f"{lesson['id']}.json",lesson)
 path_file=app/'content/learning-path.json'
 path=json.loads(path_file.read_text(encoding='utf-8-sig'))
 for level in path['levels']:
  existing=level.setdefault('lessonIds',[])
  existing.extend(m['id'] for m in plan['modules'] if m['level']==level['id'] and m['id'] not in existing)
 atomic_json(path_file,path)
 report={'version':1,'publishedAt':stamp(),'state':'complete','moduleCount':len(rows),
  'materialCount':sum(r['materialCount'] for r in rows),'exerciseCount':sum(r['exerciseCount'] for r in rows),
  'originalMaterialWords':sum(r['materialWords'] for r in rows),'theoryWords':sum(r['theoryWords'] for r in rows),
  'modules':rows,'sourceIds':[s['id'] for s in plan['sources']],'figures':figures}
 atomic_json(app/'content/extended-course-release.json',report)
 return report

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--wait',action='store_true');args=parser.parse_args()
 while args.wait:
  status_file=APP/'data/extended-build-status.json'
  status=json.loads(status_file.read_text(encoding='utf-8-sig')) if status_file.exists() else {}
  if status.get('state')=='complete':break
  if status.get('state') in ['paused','incomplete']:
   raise SystemExit('Build needs attention; no complete release was published')
  time.sleep(30)
 report=finalize()
 print(json.dumps({k:v for k,v in report.items() if k not in ['modules','sourceIds']},ensure_ascii=False))

if __name__=='__main__':main()

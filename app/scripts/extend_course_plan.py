"""Append researched bridges only after the current complete course is released.

Existing module specifications and stable IDs remain unchanged. Bridge-specific
editorial notes are part of each appended module's fingerprint.
"""
from copy import deepcopy
import argparse
import json
from pathlib import Path

from build_extended_course import APP, VERSION, digest, stamp, validate, validate_plan
from build_book_lessons import atomic_json


def merged_plan(current, supplement):
 validate_plan(current);validate_plan(supplement)
 result=deepcopy(current)
 sources={s['id']:s for s in result['sources']}
 for source in supplement['sources']:
  if source['id'] in sources:
   if sources[source['id']]['url']!=source['url']:
    raise ValueError('Conflicting research source: '+source['id'])
  else:
   result['sources'].append(deepcopy(source));sources[source['id']]=source
 modules={m['id']:m for m in result['modules']}
 for value in supplement['modules']:
  module=deepcopy(value)
  module['authoringRules']=supplement.get('authoringRules',[])+module.get('authoringRules',[])
  if module['id'] in modules:
   if digest(module)!=digest(modules[module['id']]):
    raise ValueError('Conflicting existing lesson specification: '+module['id'])
  else:
   result['modules'].append(module);modules[module['id']]=module
 validate_plan(result)
 return result


def extend(app, supplement_path, apply=False):
 current_path=app/'content/extended-course-plan.json'
 current=json.loads(current_path.read_text(encoding='utf-8-sig'))
 supplement=json.loads(supplement_path.read_text(encoding='utf-8-sig'))
 result=merged_plan(current,supplement)
 added=len(result['modules'])-len(current['modules'])
 report={'before':len(current['modules']),'after':len(result['modules']),'added':added,
  'materials':sum(len(m['materials']) for m in result['modules']),
  'exercises':sum(len(m['exercisePlan']) for m in result['modules']),'applied':False}
 if not apply or not added:return report
 release=json.loads((app/'content/extended-course-release.json').read_text(encoding='utf-8-sig'))
 lessons=json.loads((app/'content/courses/extended-skills.json').read_text(encoding='utf-8-sig'))
 current_ids={m['id'] for m in current['modules']}
 released={m['id']:m for m in release.get('modules',[])}
 if release.get('state')!='complete' or set(released)!=current_ids or {l['id'] for l in lessons}!=current_ids:
  raise ValueError('Finish and release every currently planned lesson before expanding this queue')
 if any(released[l['id']]['lessonSHA256']!=digest(l) for l in lessons):
  raise ValueError('Current course changed after its release verification')
 specifications={m['id']:m for m in current['modules']}
 for lesson in lessons:
  specification=specifications[lesson['id']];validate(lesson,specification)
  provenance=lesson.get('provenance',{})
  if provenance.get('specHash')!=digest(specification) or provenance.get('promptVersion')!=VERSION:
   raise ValueError('Current lesson does not match its researched specification')
 result['status']='preparation-expanded'
 history=result.setdefault('extensionHistory',[])
 history.append({'at':stamp(),'from':supplement_path.name,'supplementSHA256':digest(supplement),
  'added':added,'previousModuleCount':len(current['modules'])})
 atomic_json(current_path,result)
 report['applied']=True
 return report


def main():
 parser=argparse.ArgumentParser()
 parser.add_argument('--supplement',type=Path,default=APP/'content/external-topic-bridge-plan.json')
 parser.add_argument('--apply',action='store_true')
 args=parser.parse_args()
 print(json.dumps(extend(APP,args.supplement,args.apply),ensure_ascii=False))


if __name__=='__main__':main()

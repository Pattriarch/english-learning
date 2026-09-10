from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest

from build_extended_course import APP, digest
from build_book_lessons import atomic_json
from extend_course_plan import extend, merged_plan


class CourseExpansionTests(unittest.TestCase):
 def setUp(self):
  temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
  self.app=Path(temporary.name)
  plan=json.loads((APP/'content/extended-course-plan.json').read_text(encoding='utf-8-sig'))
  self.current={**plan,'modules':plan['modules'][:1]}
  self.supplement=json.loads((APP/'content/external-topic-bridge-plan.json').read_text(encoding='utf-8-sig'))
  lessons=json.loads((APP/'content/courses/extended-skills.json').read_text(encoding='utf-8-sig'))
  self.lesson=next(l for l in lessons if l['id']==self.current['modules'][0]['id'])
  self.plan_path=self.app/'content/extended-course-plan.json'
  self.extra_path=self.app/'supplement.json'
  atomic_json(self.plan_path,self.current);atomic_json(self.extra_path,self.supplement)
  atomic_json(self.app/'content/courses/extended-skills.json',[self.lesson])
  atomic_json(self.app/'content/extended-course-release.json',{'state':'complete','modules':[{'id':self.lesson['id'],'lessonSHA256':digest(self.lesson)}]})

 def test_expansion_preserves_previous_specs_and_is_idempotent(self):
  report=extend(self.app,self.extra_path,apply=True)
  self.assertEqual(report['added'],5)
  result=json.loads(self.plan_path.read_text(encoding='utf-8'))
  self.assertEqual(result['modules'][0],self.current['modules'][0])
  self.assertEqual(result['modules'][1]['authoringRules'],self.supplement['authoringRules'])
  before=self.plan_path.read_bytes()
  self.assertEqual(extend(self.app,self.extra_path,apply=True)['added'],0)
  self.assertEqual(self.plan_path.read_bytes(),before)

 def test_unreleased_or_changed_course_cannot_expand(self):
  before=self.plan_path.read_bytes()
  changed=deepcopy(self.lesson);changed['goal']='Changed after the verified release'
  atomic_json(self.app/'content/courses/extended-skills.json',[changed])
  with self.assertRaisesRegex(ValueError,'changed after'):extend(self.app,self.extra_path,apply=True)
  self.assertEqual(self.plan_path.read_bytes(),before)
  atomic_json(self.app/'content/courses/extended-skills.json',[self.lesson])
  atomic_json(self.app/'content/extended-course-release.json',{'state':'incomplete','modules':[]})
  with self.assertRaisesRegex(ValueError,'Finish and release'):extend(self.app,self.extra_path,apply=True)
  self.assertEqual(self.plan_path.read_bytes(),before)

 def test_source_id_cannot_be_reassigned_to_another_url(self):
  extra=deepcopy(self.supplement)
  extra['sources'].append({**self.current['sources'][0],'url':'https://example.org/unrelated'})
  with self.assertRaisesRegex(ValueError,'Conflicting research source'):merged_plan(self.current,extra)


if __name__=='__main__':unittest.main()

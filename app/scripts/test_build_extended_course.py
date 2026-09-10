"""Resume must preserve published lessons and reject obsolete/incomplete caches."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import build_extended_course as builder


class ExtendedResumeTests(unittest.TestCase):
 def test_prepared_image_formats_are_bounded(self):
  figure={'id':'courtyard-actions','format':'png','alt':'Four adults','caption':'Original fictional scene'}
  builder.validate_figure(figure,'reference')
  for value in ['jpg','../png',42,None]:
   with self.assertRaises(ValueError):builder.validate_figure({**figure,'format':value},'reference')
  with self.assertRaises(ValueError):builder.validate_figure(figure,'listening')

 def setUp(self):
  self.workspace=tempfile.TemporaryDirectory()
  self.addCleanup(self.workspace.cleanup)
  self.app=Path(self.workspace.name)
  self.args=argparse.Namespace(data=self.app/'data',resume=True,workers=2)
  self.plan=json.loads((builder.APP/'content/extended-course-plan.json').read_text(encoding='utf-8-sig'))
  prepared=json.loads((builder.APP/'content/courses/extended-skills.json').read_text(encoding='utf-8-sig'))
  by_id={lesson['id']:lesson for lesson in prepared}
  self.modules=self.plan['modules'][:3]
  self.lessons=[deepcopy(by_id[module['id']]) for module in self.modules]
  for module,lesson in zip(self.modules,self.lessons):
   builder.validate(lesson,module)

 def cache(self,index):
  module=self.modules[index]
  builder.atomic_json(self.args.data/'extended-lessons'/f"{module['id']}.json",self.lessons[index])

 def test_cache_requires_current_prompt_and_complete_materials(self):
  self.cache(0)
  self.assertEqual(builder.cached_lesson(self.modules[0],self.args)['id'],self.modules[0]['id'])
  self.lessons[0]['provenance']['promptVersion']='obsolete'
  self.cache(0)
  self.assertIsNone(builder.cached_lesson(self.modules[0],self.args))
  self.lessons[0]['provenance']['promptVersion']=builder.VERSION
  self.lessons[0]['materials'][0]['text']='Missing source.'
  self.cache(0)
  self.assertIsNone(builder.cached_lesson(self.modules[0],self.args))

 def test_failure_of_new_module_never_removes_ready_cached_lessons(self):
  self.cache(0);self.cache(1)
  snapshots=[]
  write=builder.atomic_json
  def publish(path,value):
   if path==self.app/'content/courses/extended-skills.json':snapshots.append([lesson['id'] for lesson in value])
   write(path,value)
  plan={**self.plan,'modules':self.modules}
  with patch.object(builder,'APP',self.app),patch.object(builder,'codex_command',return_value=['unused']),patch.object(builder,'atomic_json',side_effect=publish),patch.object(builder,'build',side_effect=RuntimeError('Provider unavailable')) as build:
   with self.assertRaises(SystemExit):builder.run(plan,self.args)
  self.assertEqual(build.call_count,1,'Only the missing lesson may use the provider')
  expected=[m['id'] for m in self.modules[:2]]
  self.assertTrue(snapshots)
  self.assertTrue(all(snapshot==expected for snapshot in snapshots))
  status=json.loads((self.args.data/'extended-build-status.json').read_text())
  self.assertEqual(status['ready'],2)
  self.assertEqual(status['state'],'incomplete')

 def test_completed_resume_needs_no_provider_calls(self):
  for index in range(3):self.cache(index)
  with patch.object(builder,'APP',self.app),patch.object(builder,'codex_command',return_value=['unused']),patch.object(builder,'build') as build:
   builder.run({**self.plan,'modules':self.modules},self.args)
  build.assert_not_called()
  published=json.loads((self.app/'content/courses/extended-skills.json').read_text(encoding='utf-8'))
  self.assertEqual([l['id'] for l in published],[m['id'] for m in self.modules])
  status=json.loads((self.args.data/'extended-build-status.json').read_text())
  self.assertEqual(status['state'],'complete')


if __name__=='__main__':unittest.main()

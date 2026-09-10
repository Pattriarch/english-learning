"""Content contract checks for the two manually authored B2 additions."""
import json
from pathlib import Path
import unittest
from copy import deepcopy
from author_b2_regret_sleep_lessons import regret_lesson, sleep_lesson, REGRET, SLEEP, SOURCES
from build_extended_course import validate, validate_plan, words, digest, VERSION
from extend_course_plan import merged_plan


class B2AdditionTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.pairs=[(REGRET,regret_lesson()),(SLEEP,sleep_lesson())]

 def test_complete_answers_obey_both_ends_of_requested_ranges(self):
  validate_plan(dict(modules=[REGRET,SLEEP],sources=SOURCES))
  for module,lesson in self.pairs:
   with self.subTest(lesson=lesson['id']):
    validate(lesson,module)
    self.assertEqual(lesson['provenance']['specHash'],digest(module))
    self.assertEqual(lesson['provenance']['promptVersion'],VERSION)
    for planned,exercise in zip(module['exercisePlan'],lesson['exercises']):
     self.assertGreaterEqual(words(exercise['answers'][0]),planned['minAnswerWords'])
     if 'maxAnswerWords' in planned:
      self.assertLessEqual(words(exercise['answers'][0]),planned['maxAnswerWords'])
     self.assertGreaterEqual(words(exercise['explanation']),55)

 def test_late_facts_are_not_exposed_before_their_material(self):
  # A schema validator cannot detect an accidental spoiler in theory or a hint.
  secrets=[['automatic booking reply','автоматический ответ','автоматического ответа','test booking','тестовую бронь'],
           ['Jon','Джон','breathing interruptions','остановк','stop and start']]
  for (_,lesson),needles in zip(self.pairs,secrets):
   early={k:lesson[k] for k in ['formula','sections','examples']}
   early['materials']=lesson['materials'][:2]
   early['exercises']=lesson['exercises'][:5]
   text=json.dumps(early,ensure_ascii=False).lower()
   for phrase in needles:self.assertFalse(phrase.lower() in text,f"{lesson['id']}: early disclosure of {phrase}")
   for e in lesson['exercises'][:5]:self.assertNotIn('m3',e['materialIds'])
   for e in lesson['exercises'][5:]:self.assertIn('m3',e['materialIds'])

 def test_reference_practises_all_three_full_emphatic_forms(self):
  answer=self.pairs[0][1]['exercises'][4]['answers'][0]
  self.assertRegex(answer,r'I do want\b')
  self.assertRegex(answer,r'Sam does care\b')
  self.assertRegex(answer,r'He did help\b')
  self.assertNotRegex(answer,r'(?i)\b(?:does cares|did helped)\b')
  # The combined topic must actually require emotional If only in output.
  self.assertIn('If only',self.pairs[0][1]['exercises'][1]['prompt'])
  self.assertIn('If only',self.pairs[0][1]['exercises'][1]['answers'][0])

 def test_sleep_replies_retain_observation_source_and_unknown_cause(self):
  lesson=self.pairs[1][1]
  sources={s['id']:s for s in SOURCES}
  medical=[sources[i] for i in SLEEP['sourceIds'] if i.endswith('-nhs')]
  self.assertEqual(len(medical),4)
  self.assertTrue(all(s['url'].startswith('https://www.nhs.uk/') for s in medical))
  reply=lesson['exercises'][5]['answers'][0]
  self.assertIn('GP',reply)
  self.assertIn("partner's observations",reply)
  self.assertIn('does not establish the cause',reply)
  monologue=lesson['exercises'][6]['answers'][0]
  self.assertIn('twice',monologue)
  self.assertIn('On another day',monologue)
  self.assertEqual(monologue.count('?'),2)

 def test_publisher_merge_preserves_prepared_module_fingerprints(self):
  existing=deepcopy(REGRET);existing['id']='extended-existing-example'
  current=dict(modules=[existing],sources=SOURCES)
  supplement=dict(modules=[REGRET,SLEEP],sources=SOURCES,authoringRules=[])
  result=merged_plan(current,supplement)
  self.assertEqual(digest(result['modules'][0]),digest(existing))
  for expected,actual in zip([REGRET,SLEEP],result['modules'][1:]):
   self.assertEqual(digest(actual),digest(expected))


if __name__=='__main__':unittest.main()

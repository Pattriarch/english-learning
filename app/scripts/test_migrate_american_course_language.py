from copy import deepcopy
import unittest

from migrate_american_course_language import (spelling, transform, teaching_field,
    identity, update_corrections, PROTECTED_LESSONS)


class AmericanCourseMigrationTests(unittest.TestCase):
    def test_whitelist_does_not_convert_arbitrary_ise_or_plural_analyses(self):
        self.assertEqual(spelling('exercise promise revise precise analyses organise recognised'),
                         'exercise promise revise precise analyses organize recognized')
        self.assertEqual(spelling("centre centred traveller neighbour’s organisation-wide"),
                         "center centered traveler neighbor’s organization-wide")

    def test_names_and_urls_keep_original_spelling(self):
        text='Neighbour Link at River Centre; Greenbridge Language Centre. https://example.test/organise/colour'
        self.assertEqual(spelling(text),text)
        self.assertEqual(spelling('Neighbour: Could you organise the programme?'),
                         'Neighbor: Could you organize the program?')

    def test_lexical_changes_keep_articles_and_capitalized_explanation_in_sync(self):
        self.assertEqual(transform('path-gerund-infinitive','Thank you for helping me find a flat. A flat is nearby. A new flat is ready.'),
                         'Thank you for helping me find an apartment. An apartment is nearby. A new apartment is ready.')
        self.assertEqual(transform('extended-b1-procedure','There is a lift and a new lift.'),
                         'There is an elevator and a new elevator.')
        self.assertEqual(transform('extended-b2-sleep','Flatmate подходит для соседа по квартире.'),
                         'Roommate подходит для соседа по квартире.')
        self.assertEqual(transform('extended-c2-literary','A waistcoat in the boot of her car; a cupboard nearby.'),
                         'A vest in the trunk of her car; a cupboard nearby.')

    def test_context_sensitive_lexis_preserves_verbs_and_nonhousing_flat(self):
        self.assertEqual(transform('cinema-bcs-s01e03-respond',
            "The camera above the lift stopped. I'll lift it and check. My flatmate is here."),
            "The camera above the elevator stopped. I'll lift it and check. My roommate is here.")
        self.assertEqual(transform('cinema-bcs-s01e05-respond','Dry it flat. Use a flat surface.'),
                         'Dry it flat. Use a flat surface.')
        self.assertEqual(transform('path-there-is','There are two rooms in the flat.'),
                         'There are two rooms in the apartment.')
        self.assertEqual(transform('path-politeness-power','The support queue is busy.'),
                         'The support queue is busy.')

    def test_british_comparisons_and_explicit_scenarios_are_protected(self):
        for text in ['British house style: organise, not organize.',
                     'В британском варианте practise, в американском practice.']:
            self.assertEqual(transform('any',text),text)
        for lid in ['extended-c2-editor','extended-a1-notices','extended-b2-reference-letter','extended-c1-conversion']:
            self.assertIn(lid,PROTECTED_LESSONS)

    def test_sources_identifiers_and_provenance_are_not_teaching_fields(self):
        for path in [('id',),('provenance','sourceIds',0),('materials',0,'source'),
                     ('materials',0,'id'),('exercises',0,'id'),('sources',0,'title')]:
            self.assertFalse(teaching_field(path),path)
        self.assertTrue(teaching_field(('exercises',0,'explanation')))
        self.assertTrue(teaching_field(('examples',0,'en')))

    def test_revision_changes_words_without_changing_task_or_material_identity(self):
        old={'id':'one','exercises':[{'id':'e1','kind':'rewrite','materialIds':['m1'],'prompt':'Organise a message.'}],
             'materials':[{'id':'m1','kind':'reading','text':'A neighbourhood report.'}]}
        new=deepcopy(old);new['exercises'][0]['prompt']='Organize a message.'
        self.assertEqual(identity(old),identity(new))

    def test_existing_parent_corrections_replay_the_migrated_object(self):
        before={'id':'one','materials':[{'id':'m1','text':'The centre.'}],
                'sections':[{'body':'We organise.'}]}
        after=deepcopy(before);after['materials'][0]['text']='The center.';after['sections'][0]['body']='We organize.'
        old={'version':1,'corrections':[{'lessonId':'one','reason':'Earlier authoring correction',
              'changes':[{'path':['materials'],'before':[],'after':before['materials']}]}]}
        receipts=[{'lessonId':'one','file':'courses/extended-skills.json','path':['materials',0,'text']},
                  {'lessonId':'one','file':'courses/extended-skills.json','path':['sections',0,'body']}]
        result=update_corrections(old,{'one':before},{'one':after},receipts)
        self.assertEqual(result['corrections'][0]['changes'][0]['before'],[])
        self.assertEqual(result['corrections'][0]['changes'][0]['after'],after['materials'])
        self.assertEqual(result['corrections'][1]['changes'][0]['before'],'We organise.')
        self.assertEqual(old['corrections'][0]['changes'][0]['after'],before['materials'])


if __name__=='__main__': unittest.main()

import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import migrate_pronunciation_us as migration


class PronunciationUS(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.course = json.loads((migration.APP / 'content/pronunciation.json').read_text('utf-8'))

    def lesson(self, number):
        return self.course['lessons'][number - 1]

    def test_current_catalog_preserves_sixteen_progress_ids_and_full_practice(self):
        migration.validate(self.course)
        expected = ['letters-and-sounds','ipa-and-dictionary','front-vowels','central-back-vowels','diphthongs','schwa','voicing-and-endings','th','w-v-r-l-ng','sh-ch-j','spelling-and-silent-letters','ed-endings','s-endings','word-stress','rhythm-and-linking','intonation-and-shadowing']
        self.assertEqual([f'pron-{i:02d}-{name}' for i,name in enumerate(expected,1)], [l['id'] for l in self.course['lessons']])
        self.assertEqual(sum(l['minutes'] for l in self.course['lessons']),475)
        for lesson in self.course['lessons']:
            self.assertGreaterEqual(len(lesson['practice']['criteria']),3)
            self.assertGreater(len(lesson['practice']['reference'].split()),25)

    def test_american_vowels_and_postvocalic_r_are_in_playable_word_examples(self):
        cases={1:{'shop':'/ʃɑːp/'},2:{'information':'/ˌɪnfərˈmeɪʃən/'},4:{'cart':'/kɑːrt/','cot':'/kɑːt/','bird':'/bɜːrd/'},5:{'home':'/hoʊm/','near':'/nɪr/','hair':'/her/','cure':'/kjʊr/'},6:{'banana':'/bəˈnænə/'},9:{'car':'/kɑːr/','singer':'/ˈsɪŋər/'},12:{'worked':'/wɜːrkt/'},14:{'photograph':'/ˈfoʊtəɡræf/','photography':'/fəˈtɑːɡrəfi/'}}
        for number,expected in cases.items():
            words={e['word']:e['ipa'] for s in self.lesson(number)['sounds'] for e in s['examples']}
            for word,ipa in expected.items(): self.assertEqual(words[word],ipa,(number,word))
        self.assertIn('home has /oʊ/',self.lesson(5)['practice']['reference'])
        self.assertNotIn('/əʊ/',self.lesson(5)['examples'][0]['note'])

    def test_legitimate_british_and_merged_variants_are_explicitly_retained(self):
        body=' '.join(s['body'] for s in self.lesson(4)['explanation'])
        self.assertIn('Оба варианта допустимы',body)
        self.assertIn('/bæθ/',body)
        self.assertIn('/bɑːθ/',body)
        self.assertIn('/bɜːd/',body)
        self.assertIn('/tʊə(r)/',self.lesson(5)['explanation'][3]['body'])
        self.assertIn('far from here',self.lesson(15)['explanation'][1]['body'])
        self.assertIn('в far from here r обычно не произносится',self.lesson(15)['explanation'][1]['body'])

    def test_tap_teaches_position_and_requires_original_output_without_forced_reduction(self):
        l=self.lesson(15)
        body=l['explanation'][-1]['body']
        self.assertIn('перед безударным',body)
        self.assertIn('attack',body)
        self.assertIn('допустима',body)
        self.assertIn('три своих предложения',l['practice']['prompt'])
        for word in ['city','better','ladder']:
            self.assertIn(word,l['practice']['reference'])
        self.assertIn('A clear t is also acceptable',l['practice']['reference'])
        self.assertEqual(l['sounds'][-1]['ipa'],'[ɾ]')

    def test_audio_manifest_inputs_are_english_and_keep_existing_lexical_texts(self):
        texts=migration.audio_texts(self.course)
        self.assertEqual(len(texts),224)
        for word in ['bird','cot','caught','tour','cure','photograph','city','better','ladder']:
            self.assertIn(word,texts)
        self.assertNotIn('I wanted to practise before the next lesson.',texts)
        self.assertIn('I wanted to practice before the next lesson.',texts)
        self.assertFalse(any('ɾ' in text or '/r/' in text for text in texts))

    def test_unknown_source_does_not_write_or_create_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);p=root/'course.json';p.write_text('{}','utf-8')
            with self.assertRaisesRegex(ValueError,'Source hash changed'):
                migration.run(p,root/'receipt.json',root/'backup',True)
            self.assertEqual(p.read_text('utf-8'),'{}')
            self.assertFalse((root/'receipt.json').exists())
            self.assertFalse((root/'backup').exists())

    def test_atomic_publish_preserves_original_and_exact_repeat_is_idempotent(self):
        original=copy.deepcopy(self.course);original['description']='Original description'
        raw=migration.encoded(original)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);p=root/'course.json';p.write_bytes(raw)
            with patch.object(migration,'BEFORE_SHA',migration.sha(raw)),patch.object(migration,'migrate',return_value=self.course):
                first=migration.run(p,root/'receipt.json',root/'backup',True)
                self.assertEqual(first['state'],'applied')
                self.assertEqual(next((root/'backup').iterdir()).read_bytes(),raw)
                self.assertEqual(migration.run(p,root/'receipt.json',root/'backup',True)['state'],'already-applied')
                changed=json.loads(p.read_bytes());changed['title']='Concurrent editorial change';p.write_bytes(migration.encoded(changed))
                with self.assertRaises(ValueError):migration.run(p,root/'receipt.json',root/'backup',True)
                self.assertEqual(json.loads(p.read_bytes())['title'],'Concurrent editorial change')

    def test_editorial_transform_is_reproducible_when_private_backup_is_present(self):
        p=migration.APP/'data/backups'/f'pronunciation-before-us-{migration.BEFORE_SHA}.json'
        if not p.exists():self.skipTest('Private original backup is intentionally not required in a clean clone')
        before=json.loads(p.read_bytes());snapshot=copy.deepcopy(before)
        result=migration.migrate(before)
        self.assertEqual(before,snapshot)
        self.assertEqual(result,self.course)
        self.assertEqual(result['lessons'][2],before['lessons'][2])
        self.assertEqual(result['lessons'][6],before['lessons'][6])
        for old,new in zip(before['lessons'],result['lessons']):
            # Existing checklist indices retain their meanings; new criteria are appended.
            self.assertEqual(old['practice']['criteria'],new['practice']['criteria'][:len(old['practice']['criteria'])])


if __name__ == '__main__': unittest.main()

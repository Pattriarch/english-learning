import json
from pathlib import Path
import tempfile
import unittest
import wave

from verify_book_audio import verify


class BookAudioVerificationTests(unittest.TestCase):
    def fixture(self, root):
        lessons, audio = Path(root)/'lessons', Path(root)/'audio'
        lessons.mkdir(); audio.mkdir()
        (lessons/'unit.json').write_text(json.dumps({'examples':[{'en':'An example sentence.'}]}), encoding='utf-8')
        name = 'a'*64+'.wav'
        (audio/'unit.json').write_text(json.dumps({'clips':{'An example sentence.':name}}), encoding='utf-8')
        with wave.open(str(audio/name), 'wb') as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
            wav.writeframes(b'\0\0'*16000)
        return lessons, audio, name

    def test_matches_current_examples_to_readable_wav(self):
        with tempfile.TemporaryDirectory() as root:
            lessons, audio, _ = self.fixture(root)
            result = verify(lessons, audio)
            self.assertEqual(result['completeUnits'], 1)
            self.assertEqual(result['issues'], [])

    def test_index_of_old_example_does_not_cover_new_example(self):
        with tempfile.TemporaryDirectory() as root:
            lessons, audio, _ = self.fixture(root)
            (lessons/'unit.json').write_text(json.dumps({'examples':[{'en':'A replacement example.'}]}), encoding='utf-8')
            result = verify(lessons, audio)
            self.assertEqual(result['completeUnits'], 0)
            self.assertTrue(result['issues'])

    def test_truncated_payload_is_not_treated_as_ready(self):
        with tempfile.TemporaryDirectory() as root:
            lessons, audio, name = self.fixture(root)
            path = audio/name
            path.write_bytes(path.read_bytes()[:-100])
            self.assertEqual(verify(lessons, audio)['completeUnits'], 0)

    def test_clip_index_cannot_escape_audio_directory(self):
        with tempfile.TemporaryDirectory() as root:
            lessons, audio, _ = self.fixture(root)
            (audio/'unit.json').write_text(json.dumps({'clips':{'An example sentence.':'../outside.wav'}}), encoding='utf-8')
            self.assertEqual(verify(lessons, audio)['completeUnits'], 0)


if __name__ == '__main__':
    unittest.main()

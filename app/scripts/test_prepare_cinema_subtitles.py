import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from prepare_cinema_subtitles import prepare


class CinemaSubtitleInstallTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.app=Path(self.temp.name);(self.app/'content').mkdir()
        episodes=[{'id':f'bcs-s01e{n:02d}','number':n,'title':f'Episode {n}'} for n in range(1,11)]
        (self.app/'content/cinema.json').write_text(json.dumps({'series':[{'episodes':episodes}]}))
        self.archive=self.app/'season.zip'
        self.raw='\r\n\r\n'.join(f'{n}\r\n00:00:01,000 --> 00:00:02,000\r\nThat’s useful.' for n in range(1,102)).encode('cp1252')

    def zip(self,bad=None):
        with zipfile.ZipFile(self.archive,'w') as z:
            for n in range(1,11):
                name=f'Better Call Saul - 1x{n:02d} - Episode.en.srt'
                if n==10 and bad=='path':name='../'+name
                z.writestr(name,b'broken' if n==10 and bad=='broken' else self.raw)

    def test_complete_archive_converts_encoding_and_repeated_install_keeps_files(self):
        self.zip();result=prepare(self.archive,self.app)
        self.assertEqual(sum(e['cueCount'] for e in result['episodes']),1010)
        file=self.app/'studio/cinema-subtitles/bcs-s01e01.en.srt';stamp=file.stat().st_mtime_ns
        self.assertIn('That’s useful.',file.read_text(encoding='utf-8'));self.assertNotIn(b'\r',file.read_bytes())
        prepare(self.archive,self.app);self.assertEqual(file.stat().st_mtime_ns,stamp)

    def test_invalid_last_member_publishes_no_partial_season(self):
        for bad in ('path','broken'):
            self.zip(bad)
            with self.assertRaises(ValueError):prepare(self.archive,self.app)
            self.assertFalse((self.app/'studio/cinema-subtitles').exists())

    def test_existing_user_version_is_preserved(self):
        self.zip();prepare(self.archive,self.app)
        file=self.app/'studio/cinema-subtitles/bcs-s01e07.en.srt';file.write_text('My own version')
        with self.assertRaisesRegex(ValueError,'Different local subtitle version'):prepare(self.archive,self.app)
        self.assertEqual(file.read_text(),'My own version')


if __name__=='__main__':unittest.main()

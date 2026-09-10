"""Install an acquired season archive for local study; never copy it into Git.

Usage: python app/scripts/prepare_cinema_subtitles.py path/to/season.zip
No network calls. Original files, encoding and archive hashes are recorded.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile
from datetime import datetime, timezone
from build_book_lessons import atomic_json

APP=Path(__file__).resolve().parents[1]
def sha(raw):return hashlib.sha256(raw).hexdigest()

def prepare(archive,app=APP):
    episodes=json.loads((app/'content/cinema.json').read_text(encoding='utf-8-sig'))['series'][0]['episodes']
    expected={e['number']:e for e in episodes}
    if set(expected)!=set(range(1,11)) or any(e['id']!=f'bcs-s01e{n:02d}' for n,e in expected.items()):
        raise ValueError('Unexpected season catalog identities')
    parsed={}
    with zipfile.ZipFile(archive) as source:
        entries=source.infolist()
        if len(entries)!=10 or sum(e.file_size for e in entries)>5*1024*1024:
            raise ValueError('Expected ten small subtitle files')
        for entry in entries:
            if any(c in entry.filename for c in '/\\:') or not entry.filename.lower().endswith('.srt'):
                raise ValueError('Unexpected archive member')
            match=re.fullmatch(r'Better Call Saul - 1x(\d{2}) - .+\.en\.srt',entry.filename)
            if not match:raise ValueError('Unexpected episode filename')
            number=int(match[1])
            if number not in expected or number in parsed:raise ValueError('Duplicate/unknown episode')
            raw=source.read(entry)
            try:text=raw.decode('utf-8-sig');encoding='utf-8'
            except UnicodeDecodeError:text=raw.decode('cp1252');encoding='windows-1252'
            text=text.replace('\r\n','\n').replace('\r','\n')
            times=re.findall(r'^(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})',text,re.M)
            if len(times)<100:raise ValueError('Not a complete episode subtitle file')
            episode=expected[number];filename=episode['id']+'.en.srt'
            parsed[number]=({'episodeId':episode['id'],'episodeNumber':number,'title':episode['title'],
                'filename':filename,'originalFilename':entry.filename,'sourceEncoding':encoding,
                'sourceSHA256':sha(raw),'sha256':sha(text.encode()),'cueCount':len(times),
                'firstCue':times[0][0],'lastCue':times[-1][1],'videoAlignmentVerified':False},text)
    if set(parsed)!=set(expected):raise ValueError('Season is incomplete')
    output=app/'studio/cinema-subtitles';output.mkdir(parents=True,exist_ok=True)
    # Validate the entire archive before publishing any source file.
    for row,text in parsed.values():
        target=output/row['filename']
        if target.exists() and sha(target.read_bytes())!=row['sha256']:
            raise ValueError('Different local subtitle version already exists: '+row['episodeId'])
    for row,text in parsed.values():
        target=output/row['filename']
        if not target.exists():target.write_text(text,encoding='utf-8',newline='\n')
    manifest={'version':1,'preparedAt':datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'seriesId':'better-call-saul','season':1,'language':'en','archiveSHA256':sha(archive.read_bytes()),
        'sourceURL':'https://www.tvsubtitles.net/subtitle-1643-1-en.html',
        'notice':'Local subtitle files from the named source. Timing must be checked against the learner’s video edition. No actor audio is included.',
        'episodes':[parsed[number][0] for number in sorted(parsed)]}
    atomic_json(output/'manifest.json',manifest)
    return manifest

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('archive',type=Path);args=parser.parse_args()
    result=prepare(args.archive)
    print(json.dumps({'episodes':len(result['episodes']),'cues':sum(e['cueCount'] for e in result['episodes']),
        'source':result['sourceURL'],'archiveSHA256':result['archiveSHA256']},ensure_ascii=False))

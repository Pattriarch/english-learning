"""Verify technical availability of every current book example recording.

Reads local lesson/index/WAV files only. Does not claim acoustic pronunciation
quality, synthesize audio, change lessons, or modify user progress.
"""
import argparse
import json
from pathlib import Path
import re
import wave

APP = Path(__file__).resolve().parents[1]
CLIP_NAME = re.compile(r'[0-9a-f]{64}\.wav\Z')


def verify(lessons, audio):
    lessons, audio = Path(lessons), Path(audio)
    issues, examples, complete, checked = [], 0, 0, {}
    files = sorted(lessons.glob('*.json'))
    for path in files:
        unit = path.stem
        initial = len(issues)
        try:
            lesson = json.loads(path.read_text(encoding='utf-8'))
            texts = [e['en'] for e in lesson['examples']]
            if not texts or any(not isinstance(t, str) or not t.strip() for t in texts):
                raise ValueError('Missing example text')
            examples += len(texts)
            index = json.loads((audio/f'{unit}.json').read_text(encoding='utf-8'))
            clips = index['clips']
            for number, text in enumerate(texts, 1):
                name = clips.get(text, '')
                if not isinstance(name, str) or not CLIP_NAME.fullmatch(name):
                    issues.append({'unit': unit, 'example': number, 'error': 'Missing or invalid clip index'})
                    continue
                if name not in checked:
                    try:
                        with wave.open(str(audio/name), 'rb') as wav:
                            frames, rate = wav.getnframes(), wav.getframerate()
                            if wav.getcomptype() != 'NONE' or not frames or not rate:
                                raise ValueError('Invalid PCM format')
                            if len(wav.readframes(frames)) != frames * wav.getnchannels() * wav.getsampwidth():
                                raise ValueError('Truncated audio samples')
                            checked[name] = {'seconds': frames/rate}
                    except (OSError, ValueError, wave.Error, EOFError) as error:
                        checked[name] = {'error': type(error).__name__}
                if 'error' in checked[name]:
                    issues.append({'unit': unit, 'example': number, 'error': 'Unreadable or truncated WAV'})
            if len(issues) == initial:
                complete += 1
        except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
            issues.append({'unit': unit, 'error': 'Invalid lesson or missing audio index: '+type(error).__name__})
    return {'units': len(files), 'completeUnits': complete, 'examples': examples,
        'uniqueClips': len(checked), 'issues': issues,
        'validation': 'Current example text matched to readable complete PCM WAV; acoustic quality not assessed'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lessons', type=Path, default=APP/'content/book-lessons')
    parser.add_argument('--audio', type=Path, default=APP/'studio/book-audio')
    args = parser.parse_args()
    result = verify(args.lessons, args.audio)
    print(json.dumps(result, ensure_ascii=True))
    return 1 if result['issues'] else 0


if __name__ == '__main__':
    raise SystemExit(main())

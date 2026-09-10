"""Find possible gaps in explicit textbook IPA, without editing lessons.

Counts are an inventory, not a semantic coverage score. Repeated IPA, written
stress explanations, damaged PDF glyphs, ASCII-only symbols, and slash borders
can all affect results. Every actual change requires viewing the source page.
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
import re

from publish_book_release import atomic_json

APP = Path(__file__).resolve().parents[1]
SPAN = re.compile(r'/([^/\n]{1,80})/')
IPA = re.compile(r'[\u0250-\u02ffθð]')


def ipa_spans(text):
    return [match for match in SPAN.finditer(text) if IPA.search(match.group(1))]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lessons', type=Path, default=APP/'content/book-lessons')
    parser.add_argument('--sources', type=Path, default=APP/'data/parsed-books')
    parser.add_argument('--output', type=Path, default=APP/'data/book-ipa-candidates-latest.json')
    args = parser.parse_args()
    files = sorted(args.lessons.glob('*.json'))
    units, errors = [], []
    for path in files:
        try:
            lesson = json.loads(path.read_text(encoding='utf-8'))
            source = json.loads((args.sources/path.name).read_text(encoding='utf-8'))
            text = source['text']
            spans = ipa_spans(text)
            if not spans:
                continue
            theory = '\n'.join(s.get('body', '') for s in lesson.get('sections', []))
            units.append({'unit': path.stem, 'pages': source['pages'],
                'sourceIPACount': len(spans), 'lessonIPACount': len(ipa_spans(theory)),
                'hasPronunciationWords': bool(re.search(r'произнош|произнос|ударени|транскрипц', theory, re.I)),
                'sourceIPA': [{'ipa': m.group(), 'context': text[max(0,m.start()-60):m.end()+65]} for m in spans]})
        except (OSError, ValueError, TypeError, AttributeError, KeyError) as error:
            errors.append({'unit': path.stem, 'error': type(error).__name__})
    no_ipa = [u['unit'] for u in units if u['lessonIPACount'] == 0]
    partial = [u['unit'] for u in units if 0 < u['lessonIPACount'] < u['sourceIPACount']]
    atomic_json(args.output, {'at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'files': len(files), 'note': __doc__, 'units': units, 'noLessonIPA': no_ipa,
        'fewerLessonSpans': partial, 'errors': errors})
    print(json.dumps({'files': len(files), 'sourceWithIPA': len(units),
                      'noLessonIPA': no_ipa, 'fewerLessonSpans': partial, 'errors': errors}))
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())

"""Find licensed Openverse photos; publish only after a visual choice.

search downloads candidates to app/data/word-image-candidates, outside Git.
choose resizes a reviewed photo and preserves attribution in the manifest.
Requires Pillow: python -m pip install Pillow
"""
import argparse
from datetime import date
import hashlib
import io
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request

APP = Path(__file__).resolve().parents[1]
DEST = APP / 'studio/assets/words'
HEADERS = {'User-Agent': 'EnglishWorkshop/1.0 (github.com/Pattriarch/english-learning)'}


def fetch(url, limit):
    if not url.startswith('https://'):
        raise ValueError('Only HTTPS source links are accepted')
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=30) as response:
        if not response.url.startswith('https://'):
            raise ValueError('Insecure redirect')
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Source file is too large')
    return data


def licensed(item):
    return (item.get('license') in ('by', 'by-sa', 'cc0') and item.get('creator')
            and item.get('foreign_landing_url', '').startswith('https://')
            and item.get('license_url', '').startswith('https://') and not item.get('mature'))


def search(args):
    from PIL import Image
    directory = APP / 'data/word-image-candidates' / args.word
    directory.mkdir(parents=True, exist_ok=True)
    query = urllib.parse.urlencode({'q': args.query, 'license': 'cc0,by,by-sa',
                                   'page_size': 12, 'mature': 'false', 'filter_dead': 'true'})
    response = json.loads(fetch('https://api.openverse.org/v1/images/?' + query, 2 * 1024 * 1024))
    candidates = []
    for item in response.get('results', []):
        if not licensed(item):
            continue
        try:
            raw = fetch(item['url'], 12 * 1024 * 1024)
            with Image.open(io.BytesIO(raw)) as photo:
                if photo.width * photo.height > 40_000_000:
                    continue
                photo.verify()
            filename = 'candidate-' + str(len(candidates)) + '.source'
            (directory / filename).write_bytes(raw)
            candidates.append({**item, 'file': filename, 'sha256': hashlib.sha256(raw).hexdigest()})
        except (OSError, ValueError) as error:
            print('Skipped source:', error)
        if len(candidates) == 6:
            break
    (directory / 'candidates.json').write_text(json.dumps({
        'word': args.word, 'ru': args.ru, 'query': args.query,
        'retrievedAt': date.today().isoformat(), 'candidates': candidates,
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for i, item in enumerate(candidates):
        print(i, item.get('title'), item['creator'], item['license'], item['foreign_landing_url'])
    print('Review images and source licenses before choose:', directory)


def choose(args):
    from PIL import Image, ImageOps
    if not args.reviewed:
        raise ValueError('Visually review the photo and its source license, then pass --reviewed')
    directory = APP / 'data/word-image-candidates' / args.word
    saved = json.loads((directory / 'candidates.json').read_text(encoding='utf-8'))
    item = saved['candidates'][args.index]
    if not licensed(item):
        raise ValueError('Missing attribution or unsupported license')
    raw = (directory / item['file']).read_bytes()
    if hashlib.sha256(raw).hexdigest() != item['sha256']:
        raise ValueError('Candidate changed after search')
    DEST.mkdir(parents=True, exist_ok=True)
    target = DEST / (args.word + '.jpg')
    manifest_file = DEST / 'manifest.json'
    manifest = json.loads(manifest_file.read_text(encoding='utf-8')) if manifest_file.exists() else {'version': 1, 'images': {}, 'minimalPairs': {}}
    if (target.exists() or args.word in manifest['images']) and not args.replace:
        raise ValueError('Photo already exists; use --replace for an intentional replacement')
    with Image.open(io.BytesIO(raw)) as photo:
        photo = ImageOps.exif_transpose(photo).convert('RGB')
        photo.thumbnail((960, 960))
        photo.save(target, quality=88, optimize=True)
        width, height = photo.size
    license_name = 'CC0 1.0' if item['license'] == 'cc0' else 'CC ' + item['license'].upper() + ' ' + item['license_version']
    manifest['images'][args.word] = {
        'word': args.word, 'label': args.label or args.word, 'spoken': args.spoken or args.word,
        'ru': saved['ru'], 'alt': saved['ru'] + ' — фото для слова ' + args.word,
        'src': '/assets/words/' + target.name, 'width': width, 'height': height,
        'creator': item['creator'], 'title': item['title'], 'license': license_name,
        'licenseUrl': item['license_url'], 'sourceUrl': item['foreign_landing_url'],
        'downloadUrl': item['url'], 'provider': item['source'], 'sourceId': item['id'],
        'query': saved['query'], 'retrievedAt': saved['retrievedAt'], 'reviewed': True,
        'modification': 'Уменьшено до 960 px, сохранено в JPEG; кадр не обрезан.',
        'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
        'meaningStems': [part.strip() for part in args.meaning_stems.split(',') if part.strip()],
        **({'ipa': args.ipa} if args.ipa else {}),
    }
    pending = manifest_file.with_suffix('.json.pending')
    pending.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    pending.replace(manifest_file)
    print('Added', target, 'with attribution')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    find = sub.add_parser('search')
    find.add_argument('word')
    find.add_argument('--query', required=True)
    find.add_argument('--ru', required=True)
    publish = sub.add_parser('choose')
    publish.add_argument('word')
    publish.add_argument('index', type=int)
    publish.add_argument('--reviewed', action='store_true')
    publish.add_argument('--replace', action='store_true')
    publish.add_argument('--meaning-stems', required=True)
    publish.add_argument('--ipa', default='')
    publish.add_argument('--label', default='')
    publish.add_argument('--spoken', default='')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', args.word) or getattr(args, 'index', 0) < 0:
        parser.error('Use a lowercase word key and a nonnegative index')
    try:
        (search if args.action == 'search' else choose)(args)
    except (OSError, ValueError, KeyError, IndexError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()

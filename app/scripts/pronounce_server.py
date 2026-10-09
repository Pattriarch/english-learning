"""Loopback-only pronunciation scoring by phonemes.

wav2vec2 phoneme recognition (facebook/wav2vec2-lv-60-espeak-cv-ft) hears the
sounds that were actually produced; eSpeak gives the American reference for the
same words. Both use the same eSpeak IPA symbols, so they are aligned sound by
sound. Whisper is not used here: it repairs words and hides accent errors.
"""
import argparse
import ctypes
import io
import json
import logging
import os
import pathlib
import re
import threading
import urllib.parse
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_ID = 'facebook/wav2vec2-lv-60-espeak-cv-ft'
MODEL_REVISION = 'ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4'
MAX_WAV_BYTES = 8 * 1024 * 1024  # 16 kHz mono PCM: about four minutes
MAX_TEXT_BYTES = 4096
VOWEL_START = set('aeiouɑɐɒæɛɜəɪʊʌɔɚᵻɨøœyɯɵʉä')
FILLER = re.compile(r"^(?:u+m+|u+h+m*|e+r+m*|a+h+|e+h+|h+m+|m{2,}|mhm)$")

# eSpeak writes r-colored vowels and syllabic l as one symbol. Split them so a
# missing American r is reported as the r, not as a different vowel.
SPLIT = {'ɑːɹ': ['ɑː', 'ɹ'], 'ɔːɹ': ['ɔː', 'ɹ'], 'oːɹ': ['oː', 'ɹ'], 'ɪɹ': ['ɪ', 'ɹ'],
         'ɛɹ': ['ɛ', 'ɹ'], 'ʊɹ': ['ʊ', 'ɹ'], 'aɪɚ': ['aɪ', 'ə', 'ɹ'], 'aɪə': ['aɪ', 'ə'],
         'əl': ['ə', 'l'], 'iə': ['ɪ', 'ə'], 'ɚ': ['ə', 'ɹ'], 'ɜː': ['ɜ', 'ɹ'],
         'ər': ['ə', 'ɹ']}
# Variants that native American speakers produce too.
SAME = [{'ɑː', 'ɑ', 'ɔː', 'ɔ', 'ɒ', 'ä', 'aː'}, {'iː', 'i'}, {'uː', 'u'}, {'ɹ', 'ɻ'},
        {'ɡ', 'g'}, {'l', 'ɫ', 'ɭ', 'l̩'}, {'n', 'n̩'}, {'oʊ', 'əʊ'}, {'eɪ', 'ei', 'ɛɪ'},
        {'ə', 'ɐ', 'ᵻ', 'ɨ', 'ʌ', 'ɜ'}, {'tʃ', 'tS'}, {'dʒ', 'dZ'}, {'ʒ', 'Z'}, {'ʃ', 'S'}]
REDUCED = {'ə', 'ɐ', 'ᵻ', 'ɨ'}
WEAK = {'a': ['ɐ'], 'an': ['ɐ', 'n'], 'the': ['ð', 'ə'], 'to': ['t', 'ə'], 'of': ['ə', 'v'],
        'for': ['f', 'ə', 'ɹ'], 'from': ['f', 'ɹ', 'ə', 'm'], 'than': ['ð', 'ə', 'n']}
FLAPPED = {'t': {'ɾ', 'ʔ', 'd'}, 'd': {'ɾ'}, 'ɾ': {'t', 'd', 'ɹ'}}
# Near misses: noticeable, but they do not change the word.
CLOSE = [{'oʊ', 'o', 'oː'}, {'eɪ', 'e', 'eː'}, {'ʌ', 'a', 'ɑ', 'ɑː'}, {'ɪ', 'ɛ', 'e'}, {'ɪ', 'i'},
         {'ʊ', 'u', 'uː'}, {'t', 't̪'}, {'l', 'ʎ'}]


def expand(phones):
    out = []
    for phone in phones:
        phone = re.sub(r'[0-9]', '', phone)
        if not phone or phone in ('|', '??'):
            continue
        for part in SPLIT.get(phone, [phone]):
            # eSpeak may write "ɚɹ" (favorite): one r, not two.
            if not (part == 'ɹ' and out[-1:] == ['ɹ']):
                out.append(part)
    return out


def vowel(phone):
    return phone[:1] in VOWEL_START


def relation(expected, heard):
    if expected == heard or any(expected in s and heard in s for s in SAME):
        return 'ok'
    if expected in REDUCED and vowel(heard) and heard not in ('aɪ', 'aʊ', 'ɔɪ', 'eɪ', 'oʊ'):
        return 'ok'
    # Russian softening (vʲ, tʲ): a mark of accent that keeps the word.
    if heard == expected + 'ʲ':
        return 'close'
    if heard in FLAPPED.get(expected, ()):
        return 'ok'
    if any(expected in s and heard in s for s in CLOSE):
        return 'close'
    return 'wrong'


def cost(expected, heard):
    kind = relation(expected, heard)
    if kind == 'ok':
        return 0
    if kind == 'close':
        return .4
    if vowel(expected) == vowel(heard):
        return .75
    return 1.25


def drop(phone):
    # A dropped unstressed vowel costs less, so alignment prefers dropping it.
    return .5 if phone in REDUCED else 1


def align(expected, heard):
    """Needleman-Wunsch alignment. Returns (expected index | None, heard index | None)."""
    n, m = len(expected), len(heard)
    score = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        score[i][0] = score[i - 1][0] + drop(expected[i - 1])
    for j in range(1, m + 1):
        score[0][j] = j * .8
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            score[i][j] = min(score[i - 1][j - 1] + cost(expected[i - 1], heard[j - 1]),
                              score[i - 1][j] + drop(expected[i - 1]), score[i][j - 1] + .8)
    pairs, i, j = [], n, m
    while i or j:
        if i and j and score[i][j] == score[i - 1][j - 1] + cost(expected[i - 1], heard[j - 1]):
            pairs.append((i - 1, j - 1)); i -= 1; j -= 1
        elif i and score[i][j] == score[i - 1][j] + drop(expected[i - 1]):
            pairs.append((i - 1, None)); i -= 1
        else:
            pairs.append((None, j - 1)); j -= 1
    return pairs[::-1]


def assess(words, reference, heard):
    """words: display words; reference: phone lists per word; heard: recognized phones."""
    flat = [(w, p) for w, phones in enumerate(reference) for p in phones]
    if not flat:
        raise ValueError('No English words to score')
    result = [{'word': word, 'phones': []} for word in words]
    last = None
    for e, h in align([p for _, p in flat], heard):
        if e is None:
            # A Russian habit: "sing" said as "sin-g". Report it on the ŋ.
            if last is not None and heard[h] in ('ɡ', 'k'):
                entry = result[flat[last][0]]['phones'][-1]
                if entry['p'] == 'ŋ' and entry['status'] == 'ok':
                    entry.update(status='wrong', heard='ŋɡ')
            continue
        w, phone = flat[e]
        if h is None:
            # Natives drop unstressed vowels too: fav(o)rite, ev(e)ning.
            result[w]['phones'].append({'p': phone, 'status': 'ok' if phone in REDUCED else 'missing'})
        else:
            status = relation(phone, heard[h])
            entry = {'p': phone, 'status': status}
            if status != 'ok':
                entry['heard'] = heard[h]
            result[w]['phones'].append(entry)
        last = e
    points = total = 0
    for item in result:
        phones = item['phones']
        got = sum(1 if p['status'] == 'ok' else .5 if p['status'] == 'close' else 0 for p in phones)
        item['score'] = round(got / len(phones), 2) if phones else None
        points += got
        total += len(phones)
    return {'score': round(points / total, 2), 'correct': sum(p['status'] == 'ok' for i in result for p in i['phones']),
            'total': total, 'words': result, 'heard': ' '.join(heard),
            # Far too few sounds means another phrase or silence, not an accent.
            'mismatch': len(heard) < total * .35}


def native_path(path):
    if os.name != 'nt':
        return str(path)
    buffer = ctypes.create_unicode_buffer(32768)
    size = ctypes.windll.kernel32.GetShortPathNameW(str(path), buffer, len(buffer))
    return buffer.value if 0 < size < len(buffer) else str(path)


def espeak_backend():
    import espeakng_loader
    from phonemizer.backend import EspeakBackend
    from phonemizer.backend.espeak.wrapper import EspeakWrapper
    data_path = espeakng_loader.get_data_path()
    # eSpeak's Windows C file API cannot read Unicode account paths (same fix
    # as kokoro_server.py): pass the short path right before the native call.
    if os.name == 'nt' and not getattr(EspeakWrapper, '_english_short_path_patch', False):
        original = EspeakWrapper.data_path.fget
        def c_data_path(wrapper):
            path = original(wrapper)
            if path is None or str(path).isascii():
                return path
            return pathlib.Path(native_path(path.parent)) / path.name
        EspeakWrapper.data_path = property(c_data_path)
        EspeakWrapper._english_short_path_patch = True
    os.environ['ESPEAK_DATA_PATH'] = native_path(data_path)
    os.environ['PHONEMIZER_ESPEAK_DATA_PATH'] = data_path
    EspeakWrapper.set_library(native_path(espeakng_loader.get_library_path()))
    EspeakWrapper.set_data_path(data_path)
    # A word-count warning is expected: the code falls back to single words.
    quiet = logging.getLogger('phonemizer')
    quiet.setLevel(logging.ERROR)
    return EspeakBackend('en-us', preserve_punctuation=False, with_stress=False, language_switch='remove-flags', logger=quiet)


class Scorer:
    def __init__(self, model_directory):
        import numpy as np
        import torch
        from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC
        from phonemizer.separator import Separator
        self.np, self.torch = np, torch
        self.device = 'cuda' if torch.cuda.is_available() else ('mps' if torch.backends.mps.is_available() else 'cpu')
        source = model_directory / 'model'
        self.features = Wav2Vec2FeatureExtractor.from_pretrained(source, local_files_only=True)
        self.model = Wav2Vec2ForCTC.from_pretrained(source, local_files_only=True).to(self.device).eval()
        if self.device == 'cuda':
            self.model.half()
        vocab = json.loads((source / 'vocab.json').read_text(encoding='utf-8'))
        self.tokens = {index: token for token, index in vocab.items()}
        self.blank = vocab['<pad>']
        self.skip = {vocab[t] for t in ('<pad>', '<s>', '</s>', '<unk>') if t in vocab}
        self.espeak = espeak_backend()
        self.separator = Separator(phone=' ', word=' | ', syllable='')
        self.lock = threading.Lock()
        # Health reports ready only after both halves have worked once.
        self.reference(['ready'])
        self.recognize(np.zeros(16000, dtype=np.float32))

    def reference(self, words):
        # The whole phrase gives weak forms (a /ə/, to /tə/); single words get
        # their dictionary form. Fall back when eSpeak splits words differently.
        whole = self.espeak.phonemize([' '.join(words)], separator=self.separator, strip=True)[0].split('|')
        if len(whole) == len(words):
            return [expand(part.split()) for part in whole]
        # Single words come out in dictionary form: give function words their
        # weak form, as they sound inside a phrase.
        lines = self.espeak.phonemize(words, separator=self.separator, strip=True)
        return [WEAK.get(word.lower()) or expand(line.split()) for word, line in zip(words, lines)]

    def recognize(self, samples):
        torch = self.torch
        inputs = self.features(samples, sampling_rate=16000, return_tensors='pt').input_values.to(self.device)
        if self.device == 'cuda':
            inputs = inputs.half()
        with self.lock, torch.inference_mode():
            ids = self.model(inputs).logits[0].argmax(-1).tolist()
        phones, previous = [], None
        for index in ids:
            if index != previous and index not in self.skip:
                phones.append(self.tokens[index])
            previous = index
        return expand(phones)

    def score(self, wav_bytes, text):
        samples = read_wav(wav_bytes, self.np)
        display = [w for w in re.findall(r"[A-Za-z0-9]+(?:['’][A-Za-z]+)*", text) if not FILLER.match(w.lower())][:200]
        if not display:
            raise ValueError('No English words to score')
        return assess(display, self.reference([w.replace('’', "'") for w in display]), self.recognize(samples))


def read_wav(raw, np):
    with wave.open(io.BytesIO(raw)) as source:
        if source.getsampwidth() != 2 or source.getnchannels() not in (1, 2):
            raise ValueError('Expected 16-bit PCM WAV')
        rate, channels = source.getframerate(), source.getnchannels()
        samples = np.frombuffer(source.readframes(source.getnframes()), dtype='<i2').astype(np.float32) / 32768
    if channels == 2:
        samples = samples.reshape(-1, 2).mean(axis=1)
    if rate != 16000:
        target = np.arange(0, len(samples) * 16000 / rate) * rate / 16000
        samples = np.interp(target, np.arange(len(samples)), samples).astype(np.float32)
    if len(samples) < 4000:
        raise ValueError('The recording is too short')
    return samples


def handler(scorer):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'EnglishPronunciation/1'

        def log_message(self, fmt, *args):
            # Never log the phrase or audio.
            logging.info('%s %s', self.command, self.path.split('?')[0])

        def reply(self, code, body):
            raw = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            try:
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

        def do_GET(self):
            if self.path != '/health':
                self.reply(404, {'error': 'Not found'})
                return
            self.reply(200, {'status': 'ok', 'engine': 'wav2vec2-phonemes', 'model': MODEL_ID, 'device': scorer.device})

        def do_POST(self):
            route = urllib.parse.urlsplit(self.path)
            # Only the app server calls this endpoint; no browser requests.
            if route.path != '/score' or self.headers.get('Origin') or self.headers.get_content_type() != 'audio/wav':
                self.reply(403 if route.path == '/score' else 404, {'error': 'Use the local English application'})
                return
            try:
                text = urllib.parse.parse_qs(route.query).get('text', [''])[0]
                length = int(self.headers.get('Content-Length', '0'))
                if not text.strip() or len(text.encode()) > MAX_TEXT_BYTES or length < 44 or length > MAX_WAV_BYTES:
                    raise ValueError('Send a WAV up to 8 MiB and the phrase')
                self.connection.settimeout(20)
                self.reply(200, scorer.score(self.rfile.read(length), text))
            except (ValueError, EOFError, wave.Error, OSError) as error:
                self.reply(400, {'error': str(error) or 'Invalid recording'})
            except Exception as error:
                logging.error('Scoring failed (%s)', type(error).__name__)
                self.reply(503, {'error': 'Pronunciation scoring failed'})
    return Handler


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-directory', type=pathlib.Path, required=True)
    parser.add_argument('--port', type=int, default=8881)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    scorer = Scorer(args.model_directory.resolve())
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler(scorer))
    server.daemon_threads = True
    logging.info('Pronunciation scoring ready on 127.0.0.1:%d (%s)', args.port, scorer.device)
    server.serve_forever()

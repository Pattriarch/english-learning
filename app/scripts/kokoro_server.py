"""Loopback-only English TTS using the published Kokoro ONNX model."""
import argparse
import ctypes
import io
import json
import logging
import os
import pathlib
import re
import select
import socket
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_TEXT_BYTES = 64 * 1024
MAX_WAV_BYTES = 32 * 1024 * 1024
VOICES = {'af_heart': 'en-us', 'af_bella': 'en-us', 'am_michael': 'en-us',
          'am_fenrir': 'en-us', 'bf_emma': 'en-gb'}

class SpeechCancelled(Exception):
    pass


def chunks(text, limit=650):
    """Keep all words and punctuation; bound model utterances, not whole lessons."""
    pieces = re.split(r'(?<=[.!?])\s+(?=[A-Z"“\d])|\n+', text.strip())
    pending = ''
    for piece in pieces:
        words = piece.split()
        for word in words:
            if len(word) > 200:
                raise ValueError('A word or URL is too long to pronounce; split or simplify it')
            if pending and len(pending) + len(word) + 1 > limit:
                yield pending
                pending = ''
            pending = (pending + ' ' + word).strip()
        # Prefer a sentence boundary when the segment already has enough context.
        if len(pending) >= limit // 2:
            yield pending
            pending = ''
    if pending:
        yield pending


def validate(body):
    if not isinstance(body, dict):
        raise ValueError('Expected a JSON object')
    text = body.get('input')
    voice = body.get('voice', 'af_heart')
    language = body.get('lang', 'en-us').lower()
    if not isinstance(text, str) or not text.strip() or '\x00' in text:
        raise ValueError('Provide nonempty English text')
    if len(text.encode('utf-8')) > MAX_TEXT_BYTES:
        raise ValueError('Split this text into smaller passages (64 KiB maximum)')
    if voice not in VOICES or VOICES[voice] != language:
        raise ValueError('Voice and language must match a supported English accent')
    if body.get('response_format', 'wav') != 'wav':
        raise ValueError('Only WAV output is supported')
    speed = body.get('speed', 1)
    if isinstance(speed, bool) or not isinstance(speed, (int, float)) or not .5 <= speed <= 1.5:
        raise ValueError('Speed must be between 0.5 and 1.5')
    return text.strip(), voice, language, speed


class SpeechService:
    def __init__(self, model_directory, threads):
        import numpy as np
        import onnxruntime as ort
        from kokoro_onnx import Kokoro
        from kokoro_onnx.config import EspeakConfig
        import espeakng_loader
        self.np = np
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = 1
        session = ort.InferenceSession(str(model_directory / 'kokoro-v1.0.onnx'),
                                       sess_options=options, providers=['CPUExecutionProvider'])
        # eSpeak's Windows C file API cannot read some Unicode account paths.
        # Windows' existing short path refers to the same installed data files.
        def native_path(path):
            if os.name != 'nt':
                return path
            buffer = ctypes.create_unicode_buffer(32768)
            size = ctypes.windll.kernel32.GetShortPathNameW(str(path), buffer, len(buffer))
            return buffer.value if 0 < size < len(buffer) else path
        # phonemizer 3.4 resolves a configured short path back into Unicode.
        # Convert the validated path immediately before its C API call instead.
        if os.name == 'nt':
            from phonemizer.backend.espeak.wrapper import EspeakWrapper
            if not getattr(EspeakWrapper, '_english_short_path_patch', False):
                original_path = EspeakWrapper.data_path.fget
                def c_data_path(wrapper):
                    path = original_path(wrapper)
                    if path is None or str(path).isascii():
                        return path
                    return pathlib.Path(native_path(path.parent)) / path.name
                EspeakWrapper.data_path = property(c_data_path)
                EspeakWrapper._english_short_path_patch = True
        espeak = EspeakConfig(lib_path=native_path(espeakng_loader.get_library_path()),
                              data_path=espeakng_loader.get_data_path())
        self.model = Kokoro.from_session(session, str(model_directory / 'voices-v1.0.bin'), espeak_config=espeak)
        # Health is reported only after the native phonemizer and model both work.
        self.model.create('The American English voice is ready to practice.', voice='af_heart', lang='en-us')
        self.slots = threading.BoundedSemaphore(2)
        self.inference = threading.Lock()

    def synthesize(self, text, voice, language, speed, cancelled=lambda: False):
        deadline = time.monotonic() + 175
        def check_active():
            if cancelled():
                raise SpeechCancelled()
            if time.monotonic() > deadline:
                raise TimeoutError('Split this long text into smaller passages')
        while True:
            check_active()
            if self.inference.acquire(timeout=.1):
                break
        try:
            buffers = []
            total = 44
            for chunk in chunks(text):
                check_active()
                samples, rate = self.model.create(chunk, voice=voice, speed=speed, lang=language)
                check_active()
                if rate != 24000 or not len(samples) or not self.np.isfinite(samples).all():
                    raise RuntimeError('The model returned invalid audio')
                pcm = (self.np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes()
                total += len(pcm)
                if total > MAX_WAV_BYTES:
                    raise ValueError('Audio exceeds 32 MiB; split the passage into smaller sections')
                buffers.append(pcm)
            target = io.BytesIO()
            with wave.open(target, 'wb') as out:
                out.setnchannels(1)
                out.setsampwidth(2)
                out.setframerate(24000)
                out.writeframes(b''.join(buffers))
            return target.getvalue()
        finally:
            self.inference.release()


def handler(service):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'EnglishLocalSpeech/1'

        def log_message(self, fmt, *args):
            # Do not put study text or audio in logs.
            logging.info('%s %s', self.command, self.path.split('?')[0])

        def reply(self, code, body, content_type='application/json'):
            raw = json.dumps(body).encode() if content_type == 'application/json' else body
            self.send_response(code)
            self.send_header('Content-Type', content_type)
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
            self.reply(200, {'status': 'ok', 'engine': 'kokoro-onnx',
                             'model': 'kokoro-v1.0', 'voices': list(VOICES)})

        def do_POST(self):
            if self.path != '/v1/audio/speech':
                self.reply(404, {'error': 'Not found'})
                return
            # Only the app server calls this endpoint. No browser CORS/form calls.
            if self.headers.get('Origin') or self.headers.get_content_type() != 'application/json':
                self.reply(403, {'error': 'Use the local English application'})
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if length < 1 or length > 512 * 1024:
                    raise ValueError('Invalid request size')
                self.connection.settimeout(10)
                arguments = validate(json.loads(self.rfile.read(length)))
            except (ValueError, UnicodeError, OSError, TypeError, AttributeError):
                self.reply(400, {'error': 'Invalid speech request; check text length, voice and accent'})
                return
            if not service.slots.acquire(blocking=False):
                self.reply(429, {'error': 'Speech generation is busy'})
                return
            def disconnected():
                try:
                    readable, _, _ = select.select([self.connection], [], [], 0)
                    return bool(readable) and not self.connection.recv(1, socket.MSG_PEEK)
                except (ConnectionResetError, ConnectionAbortedError, OSError):
                    return True
            try:
                audio = service.synthesize(*arguments, cancelled=disconnected)
                self.reply(200, audio, 'audio/wav')
            except SpeechCancelled:
                pass
            except ValueError as error:
                self.reply(400, {'error': str(error)})
            except TimeoutError:
                self.reply(504, {'error': 'Split the long text into shorter passages'})
            except Exception as error:
                logging.error('Speech generation failed (%s)', type(error).__name__)
                self.reply(503, {'error': 'Local speech generation failed'})
            finally:
                service.slots.release()
    return Handler


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-directory', type=pathlib.Path, required=True)
    parser.add_argument('--port', type=int, default=8880)
    parser.add_argument('--threads', type=int, default=6)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    service = SpeechService(args.model_directory.resolve(), args.threads)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler(service))
    server.daemon_threads = True
    logging.info('Kokoro ready on 127.0.0.1:%d', args.port)
    server.serve_forever()

"""Exercise the local speech boundary without downloading or loading a model."""
import http.client
import io
import json
import socket
import struct
import threading
import types
import unittest
import wave
from unittest.mock import Mock, patch

import kokoro_server as speech


class TextContractTests(unittest.TestCase):
    def test_chunks_preserve_every_word_and_punctuation_in_order(self):
        text = ('  "First question?"\nThen Dr. Jones said: don\'t skip this! '
                'lowercase follows.\t2026 is here. “Quoted sentence.”\n\n')
        text += ' '.join(f'word{number},' for number in range(700))
        for limit in (40, 650):
            with self.subTest(limit=limit):
                parts = list(speech.chunks(text, limit))
                self.assertEqual(' '.join(parts).split(), text.split())
                self.assertTrue(all(0 < len(part) <= limit for part in parts))

    def test_empty_chunk_input_produces_no_utterance(self):
        self.assertEqual(list(speech.chunks(' \n\t ')), [])

    def test_overlong_word_is_rejected_instead_of_silently_truncated(self):
        self.assertEqual(list(speech.chunks('x' * 200)), ['x' * 200])
        with self.assertRaises(ValueError):
            list(speech.chunks('x' * 201))

    def test_text_size_is_utf8_bytes_including_trimmed_whitespace(self):
        accepted = ('a ' * (speech.MAX_TEXT_BYTES // 2))
        self.assertEqual(speech.validate({'input': accepted})[0], accepted.strip())
        for rejected in (accepted + ' ', 'é' * (speech.MAX_TEXT_BYTES // 2 + 1)):
            with self.subTest(bytes=len(rejected.encode('utf-8'))):
                with self.assertRaises(ValueError):
                    speech.validate({'input': rejected})

    def test_voice_accent_and_speed_constraints(self):
        self.assertEqual(speech.validate({'input': ' Hello. '})[:3],
                         ('Hello.', 'af_heart', 'en-us'))
        for voice, language in speech.VOICES.items():
            for speed in (.5, 1.5):
                with self.subTest(voice=voice, speed=speed):
                    self.assertEqual(speech.validate({'input': 'Hello.', 'voice': voice,
                                                     'lang': language.upper(), 'speed': speed}),
                                     ('Hello.', voice, language, speed))
        for extra in ({'voice': 'bf_emma'}, {'voice': 'unknown'}, {'lang': 'ru'},
                      {'speed': True}, {'speed': float('nan')}, {'speed': float('inf')},
                      {'speed': .49}, {'speed': 1.51}, {'response_format': 'mp3'}):
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                speech.validate({'input': 'Hello.', **extra})

    def test_rejects_empty_nontext_and_nul_input(self):
        for value in (None, '', ' \n ', 123, [], 'hello\0there'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                speech.validate({'input': value})


class PCMFixture:
    """Stand in for an ndarray; these tests verify assembly, not NumPy math."""
    def __init__(self, pcm):
        self.pcm = pcm

    def __len__(self):
        return len(self.pcm) // 2

    def __mul__(self, multiplier):
        return self

    def astype(self, dtype):
        if dtype != '<i2':
            raise AssertionError('The audio boundary must use little-endian PCM16')
        return self

    def tobytes(self):
        return self.pcm


def model_fixture(outputs):
    service = speech.SpeechService.__new__(speech.SpeechService)
    service.inference = threading.Lock()
    service.slots = threading.BoundedSemaphore(2)
    service.model = types.SimpleNamespace(create=Mock(side_effect=outputs))
    service.np = types.SimpleNamespace(
        clip=lambda samples, low, high: samples,
        isfinite=lambda samples: types.SimpleNamespace(all=lambda: True))
    return service


class SynthesisTests(unittest.TestCase):
    def test_cancel_before_inference_never_calls_model(self):
        service = model_fixture([])
        with self.assertRaises(speech.SpeechCancelled):
            service.synthesize('Hello.', 'af_heart', 'en-us', 1, cancelled=lambda: True)
        service.model.create.assert_not_called()
        self.assertFalse(service.inference.locked())

    def test_cancel_during_lock_wait_does_not_release_another_request_lock(self):
        service = model_fixture([])
        service.inference.acquire()
        waiting, cancel, finished = threading.Event(), threading.Event(), threading.Event()
        errors = []

        def cancelled():
            waiting.set()
            return cancel.is_set()

        def run():
            try:
                service.synthesize('Hello.', 'af_heart', 'en-us', 1, cancelled=cancelled)
            except Exception as error:
                errors.append(error)
            finally:
                finished.set()

        worker = threading.Thread(target=run, daemon=True)
        worker.start()
        try:
            self.assertTrue(waiting.wait(1))
            cancel.set()
            self.assertTrue(finished.wait(1), 'Cancellation must not wait for the 175-second deadline')
            self.assertEqual(len(errors), 1)
            self.assertIsInstance(errors[0], speech.SpeechCancelled)
            self.assertTrue(service.inference.locked(), 'The active request still owns the lock')
            service.model.create.assert_not_called()
        finally:
            cancel.set()
            if service.inference.locked():
                service.inference.release()
            worker.join(timeout=1)

    def test_cancel_during_model_call_stops_before_next_chunk_or_final_response(self):
        for text in ('Hello.', ' '.join(f'word{number}' for number in range(300))):
            with self.subTest(multiple_chunks=len(list(speech.chunks(text))) > 1):
                service = model_fixture([])
                cancelled = threading.Event()

                def create(*args, **kwargs):
                    cancelled.set()
                    return PCMFixture(b'\0\0'), 24000

                service.model.create.side_effect = create
                with self.assertRaises(speech.SpeechCancelled):
                    service.synthesize(text, 'af_heart', 'en-us', 1, cancelled=cancelled.is_set)
                self.assertEqual(service.model.create.call_count, 1)
                self.assertFalse(service.inference.locked())

    def test_last_chunk_cannot_return_success_after_deadline(self):
        service = model_fixture([])
        clock = [0]

        def create(*args, **kwargs):
            clock[0] = 176
            return PCMFixture(b'\0\0'), 24000

        service.model.create.side_effect = create
        with patch.object(speech.time, 'monotonic', side_effect=lambda: clock[0]):
            with self.assertRaises(TimeoutError):
                service.synthesize('Hello.', 'af_heart', 'en-us', 1)
        self.assertFalse(service.inference.locked())

    def test_wav_concatenates_all_chunks_once_and_forwards_voice_settings(self):
        text = ' '.join(f'word{number}' for number in range(300))
        parts = list(speech.chunks(text))
        payloads = [struct.pack('<hh', index, -index) for index in range(1, len(parts) + 1)]
        service = model_fixture([(PCMFixture(pcm), 24000) for pcm in payloads])
        audio = service.synthesize(text, 'am_michael', 'en-us', .8)
        self.assertEqual([call.args[0] for call in service.model.create.call_args_list], parts)
        for call in service.model.create.call_args_list:
            self.assertEqual(call.kwargs, {'voice': 'am_michael', 'lang': 'en-us', 'speed': .8})
        with wave.open(io.BytesIO(audio), 'rb') as wav:
            self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate()),
                             (1, 2, 24000))
            self.assertEqual(wav.readframes(wav.getnframes()), b''.join(payloads))
        self.assertFalse(service.inference.locked())

    def test_audio_limit_includes_wav_header_and_releases_lock(self):
        self.assertEqual(speech.MAX_WAV_BYTES, 32 * 1024 * 1024)
        for limit, succeeds in ((48, True), (47, False)):
            with self.subTest(limit=limit), patch.object(speech, 'MAX_WAV_BYTES', limit):
                service = model_fixture([(PCMFixture(b'\0' * 4), 24000)])
                if succeeds:
                    self.assertEqual(len(service.synthesize('Hello.', 'af_heart', 'en-us', 1)), 48)
                else:
                    with self.assertRaises(ValueError):
                        service.synthesize('Hello.', 'af_heart', 'en-us', 1)
                self.assertFalse(service.inference.locked())

    def test_bad_model_audio_and_model_error_release_lock(self):
        for output in ((PCMFixture(b'\0\0'), 22050), (PCMFixture(b''), 24000),
                       RuntimeError('model failure')):
            with self.subTest(output=output):
                service = model_fixture([output])
                with self.assertRaises(RuntimeError):
                    service.synthesize('Hello.', 'af_heart', 'en-us', 1)
                self.assertFalse(service.inference.locked())
        service = model_fixture([(PCMFixture(b'\0\0'), 24000)])
        service.np.isfinite = lambda samples: types.SimpleNamespace(all=lambda: False)
        with self.assertRaises(RuntimeError):
            service.synthesize('Hello.', 'af_heart', 'en-us', 1)
        self.assertFalse(service.inference.locked())


class HTTPBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.service = types.SimpleNamespace(slots=threading.BoundedSemaphore(2),
                                             synthesize=Mock(return_value=b'RIFF-test'))
        self.server = speech.ThreadingHTTPServer(('127.0.0.1', 0), speech.handler(self.service))
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever,
                                       kwargs={'poll_interval': .01}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, body=None, *, method='POST', path='/v1/audio/speech', headers=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=2)
        try:
            payload = json.dumps({'input': 'Hello.'} if body is None else body).encode()
            connection.request(method, path, body=payload,
                               headers={'Content-Type': 'application/json', **(headers or {})})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def assert_slots_available(self):
        self.assertTrue(self.service.slots.acquire(blocking=False))
        self.assertTrue(self.service.slots.acquire(blocking=False))
        self.assertFalse(self.service.slots.acquire(blocking=False))
        self.service.slots.release()
        self.service.slots.release()

    def test_valid_post_and_health_contract(self):
        status, headers, body = self.request()
        self.assertEqual((status, body), (200, b'RIFF-test'))
        self.assertEqual(headers['Content-Type'], 'audio/wav')
        self.assertEqual(headers['Content-Length'], str(len(body)))
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertNotIn('Access-Control-Allow-Origin', headers)
        status, _, body = self.request(method='GET', path='/health')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['voices'], list(speech.VOICES))
        self.assert_slots_available()

    def test_rejects_browser_origins_forms_and_unknown_routes(self):
        for headers in ({'Origin': 'https://example.com'}, {'Origin': 'null'},
                        {'Content-Type': 'text/plain'},
                        {'Content-Type': 'application/x-www-form-urlencoded'}):
            with self.subTest(headers=headers):
                self.assertEqual(self.request(headers=headers)[0], 403)
        self.assertEqual(self.request(path='/unexpected')[0], 404)
        self.assertEqual(self.request(method='GET', path='/v1/audio/speech')[0], 404)
        self.service.synthesize.assert_not_called()

    def test_malformed_values_and_oversized_requests_never_start_model(self):
        for body in ([], {'input': 'Hello.', 'lang': []}, {'input': 'Hello.', 'voice': []},
                     {'input': 'x' * (speech.MAX_TEXT_BYTES + 1)}):
            with self.subTest(body_type=type(body).__name__):
                self.assertEqual(self.request(body)[0], 400)
        for length in ('0', '-1', 'not-a-number', str(512 * 1024 + 1)):
            with self.subTest(length=length):
                self.assertEqual(self.request(headers={'Content-Length': length})[0], 400)
        self.service.synthesize.assert_not_called()
        self.assert_slots_available()

    def test_full_capacity_returns_busy_and_recovers_when_slot_returns(self):
        self.service.slots.acquire()
        self.service.slots.acquire()
        try:
            self.assertEqual(self.request()[0], 429)
            self.service.synthesize.assert_not_called()
        finally:
            self.service.slots.release()
            self.service.slots.release()
        self.assertEqual(self.request()[0], 200)
        self.assert_slots_available()

    def test_failure_statuses_do_not_leak_slots_or_internal_errors(self):
        for error, status in ((ValueError('Split the passage'), 400),
                              (TimeoutError('timeout detail'), 504),
                              (RuntimeError('private model path'), 503)):
            with self.subTest(error=type(error).__name__):
                self.service.synthesize.side_effect = error
                actual, _, body = self.request()
                self.assertEqual(actual, status)
                self.assertNotIn(b'private model path', body)
                self.assert_slots_available()

    def test_disconnect_cancels_synthesis_and_releases_slot(self):
        started, finished, stop = threading.Event(), threading.Event(), threading.Event()
        observed_cancel = []

        def synthesize(*args, cancelled):
            started.set()
            try:
                while not cancelled():
                    if stop.wait(.01):
                        raise RuntimeError('Test cleanup')
                observed_cancel.append(True)
                raise speech.SpeechCancelled()
            finally:
                finished.set()

        self.service.synthesize.side_effect = synthesize
        connection = socket.create_connection(self.server.server_address, timeout=2)
        try:
            body = json.dumps({'input': 'Hello.'}).encode()
            header = ('POST /v1/audio/speech HTTP/1.1\r\nHost: 127.0.0.1\r\n'
                      'Content-Type: application/json\r\n'
                      f'Content-Length: {len(body)}\r\n\r\n').encode()
            connection.sendall(header + body)
            self.assertTrue(started.wait(1))
            connection.shutdown(socket.SHUT_RDWR)
            connection.close()
            self.assertTrue(finished.wait(1), 'EOF must reach the synthesis cancellation callback')
            self.assertEqual(observed_cancel, [True])
            # The handler releases its slot just after the synthesis callback exits.
            self.assertTrue(self.service.slots.acquire(timeout=1))
            self.assertTrue(self.service.slots.acquire(timeout=1))
            self.service.slots.release()
            self.service.slots.release()
            self.assert_slots_available()
        finally:
            stop.set()
            connection.close()


if __name__ == '__main__':
    unittest.main()

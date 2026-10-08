"""Install/start local Whisper and Kokoro on macOS, Windows and Linux.

Models, environments and binaries stay in ignored app/data. No speech text is
passed to a shell and no processes are killed, including on a port conflict.
"""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import socket
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request

APP = Path(__file__).resolve().parents[1]
WHISPER_COMMIT = 'd1be6fde11ac6e0407606b4e42fe72d34add8037'  # v1.9.5
MODELS = {
    'base.en': ('ggml-base.en.bin', 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002'),
    'small.en-q5_1': ('ggml-small.en-q5_1.bin', 'bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30'),
}
KOKORO_FILES = {
    'kokoro-v1.0.onnx': '7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5',
    'voices-v1.0.bin': 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d',
}


def run(*args, **kwargs):
    subprocess.run([str(x) for x in args], check=True, **kwargs)


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def download(url, target, sha=None):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and (sha is None or digest(target) == sha):
        return
    pending = target.with_suffix(target.suffix + '.download')
    print('Downloading ' + target.name, flush=True)
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'EnglishWorkshop/1.0'})
        with urllib.request.urlopen(request, timeout=60) as response, pending.open('wb') as out:
            shutil.copyfileobj(response, out)
        if sha and digest(pending) != sha:
            raise RuntimeError('Downloaded file failed SHA-256 verification: ' + target.name)
        pending.replace(target)
    finally:
        pending.unlink(missing_ok=True)


def python_env(directory):
    executable = directory / 'venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if not executable.exists():
        run(sys.executable, '-m', 'venv', directory / 'venv')
    return executable


def install_whisper(args):
    directory = APP / 'data/local-whisper'
    directory.mkdir(parents=True, exist_ok=True)
    accelerator = args.accelerator
    if accelerator == 'auto':
        accelerator = 'metal' if sys.platform == 'darwin' and platform.machine() == 'arm64' else ('cuda' if shutil.which('nvcc') else 'cpu')
    if accelerator == 'metal' and sys.platform != 'darwin':
        raise RuntimeError('Metal is available only on macOS')
    if accelerator == 'cuda' and not shutil.which('nvcc'):
        raise RuntimeError('CUDA build requires the NVIDIA CUDA Toolkit (nvcc) and a C++ compiler. Use --accelerator cpu if unavailable.')
    source = directory / 'source'
    marker = source / '.english-source-commit'
    if source.exists() and (not marker.exists() or marker.read_text().strip() != WHISPER_COMMIT):
        raise RuntimeError('Different source already exists in app/data/local-whisper/source; keep it and choose a clean checkout for the new installation')
    if not source.exists():
        archive = directory / ('whisper-' + WHISPER_COMMIT + '.tar.gz')
        download('https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/' + WHISPER_COMMIT, archive)
        unpack = directory / 'unpack'
        unpack.mkdir(exist_ok=True)
        with tarfile.open(archive) as bundle:
            bundle.extractall(unpack, filter='data')
        (unpack / ('whisper.cpp-' + WHISPER_COMMIT)).rename(source)
        marker.write_text(WHISPER_COMMIT)
        shutil.rmtree(unpack)
    cmake = shutil.which('cmake')
    if not cmake:
        py = python_env(directory / 'build-tools')
        run(py, '-m', 'pip', 'install', 'cmake==3.31.6')
        cmake = py.parent / ('cmake.exe' if os.name == 'nt' else 'cmake')
    build = source / 'build'
    run(cmake, '-S', source, '-B', build, '-DCMAKE_BUILD_TYPE=Release',
        '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_BUILD_EXAMPLES=ON', '-DWHISPER_BUILD_SERVER=ON',
        '-DGGML_METAL=' + ('ON' if accelerator == 'metal' else 'OFF'),
        '-DGGML_CUDA=' + ('ON' if accelerator == 'cuda' else 'OFF'))
    run(cmake, '--build', build, '--config', 'Release', '--target', 'whisper-server', '--parallel', str(min(os.cpu_count() or 4, 8)))
    filename, sha = MODELS[args.model]
    download('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/' + filename, directory / filename, sha)
    (directory / 'install-portable.json').write_text(json.dumps({'commit': WHISPER_COMMIT, 'model': filename, 'sha256': sha, 'accelerator': accelerator}, indent=2))
    print('Whisper installed: ' + accelerator + ', ' + args.model, flush=True)


def install_kokoro():
    directory = APP / 'data/local-kokoro'
    directory.mkdir(parents=True, exist_ok=True)
    py = python_env(directory)
    run(py, '-m', 'pip', 'install', '-r', APP / 'scripts/kokoro-requirements.txt')
    for filename, sha in KOKORO_FILES.items():
        download('https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/' + filename, directory / filename, sha)
    download('https://raw.githubusercontent.com/thewh1teagle/kokoro-onnx/main/LICENSE', directory / 'LICENSE.kokoro-onnx.txt')
    download('https://huggingface.co/hexgrad/Kokoro-82M/raw/main/README.md', directory / 'MODEL-CARD.md')
    print('Kokoro installed: four American English voices', flush=True)


def healthy(port, engine=None):
    try:
        with urllib.request.urlopen('http://127.0.0.1:' + str(port) + '/health', timeout=2) as response:
            result = json.load(response)
        return result.get('status') == 'ok' and (not engine or result.get('engine') == engine)
    except (OSError, ValueError):
        return False


def port_busy(port):
    with socket.socket() as probe:
        return probe.connect_ex(('127.0.0.1', port)) == 0


@contextmanager
def startup_lock(directory):
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / 'start.lock').open('a+b') as handle:
        handle.seek(0)
        if not handle.read(1):
            handle.write(b'0')
            handle.flush()
        deadline = time.monotonic() + 20
        while True:
            try:
                handle.seek(0)
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise RuntimeError('Local speech startup is already running. Retry shortly.')
                time.sleep(.25)
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == 'nt':
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def start_service(label, port, directory, command, engine=None):
    with startup_lock(directory):
        start_service_locked(label, port, directory, command, engine)


def start_service_locked(label, port, directory, command, engine=None):
    if healthy(port, engine):
        print(label + ' is already ready on port ' + str(port), flush=True)
        return
    if port_busy(port):
        raise RuntimeError('Port ' + str(port) + ' is occupied or its model is still loading. No process was stopped. Retry when ready.')
    directory.mkdir(parents=True, exist_ok=True)
    flags = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {'start_new_session': True}
    with (directory / 'server.stdout.log').open('ab') as out, (directory / 'server.stderr.log').open('ab') as err:
        process = subprocess.Popen([str(x) for x in command], cwd=directory, stdin=subprocess.DEVNULL, stdout=out, stderr=err, **flags)
    for _ in range(120):
        if process.poll() is not None:
            raise RuntimeError(label + ' stopped; see ' + str(directory / 'server.stderr.log'))
        if healthy(port, engine):
            (directory / 'server-portable.json').write_text(json.dumps({'pid':process.pid,'port':port,'executable':str(command[0]),'ready':True}, indent=2))
            print(label + ' is ready on port ' + str(port), flush=True)
            return
        time.sleep(.5)
    raise RuntimeError(label + ' is still loading; see its log and retry. The process was kept running.')


def start_whisper():
    # A configured shared server (for example speech-learning on 8178) should
    # not cause a second unused model to start. Only read our app's settings.
    settings_file = APP / 'data/studio/settings.json'
    if settings_file.exists():
        configured = json.loads(settings_file.read_text(encoding='utf-8-sig')).get('whisperUrl', '').rstrip('/')
        if configured and configured not in ('http://127.0.0.1:8080', 'http://127.0.0.1:8080/inference', 'http://localhost:8080', 'http://localhost:8080/inference'):
            print('Using the Whisper address from Settings; a second local server was not started', flush=True)
            return
    directory = APP / 'data/local-whisper'
    receipt = directory / 'install-portable.json'
    config = json.loads(receipt.read_text()) if receipt.exists() else {}
    binary = os.environ.get('WHISPER_SERVER', '')
    if not binary:
        names = ['source/build/bin/Release/whisper-server.exe','source/build/bin/whisper-server.exe','bin/Release/whisper-server.exe'] if os.name=='nt' else ['source/build/bin/whisper-server']
        binary = next((str(directory / name) for name in names if (directory / name).is_file()), '')
    if not binary:
        raise RuntimeError('Install Whisper first: python3 app/scripts/local_speech.py install --engine whisper')
    model = Path(os.environ.get('WHISPER_MODEL', '') or (directory / config.get('model', 'ggml-base.en.bin'))).resolve()
    if not model.is_file():
        raise RuntimeError('Whisper model not found: ' + str(model))
    if receipt.exists() and not os.environ.get('WHISPER_MODEL') and digest(model)!=config['sha256']:
        raise RuntimeError('Whisper model failed verification; run the installer again')
    (directory / 'public').mkdir(parents=True, exist_ok=True)
    model_arg = model.name if model.parent == directory.resolve() else str(model)
    command = [Path(binary).resolve(), '--host','127.0.0.1','--port','8080','--model',model_arg,'--language','en','--threads','6','--public','public']
    start_service('Whisper',8080,directory,command)


def start_kokoro():
    directory = APP / 'data/local-kokoro'
    py = directory / 'venv' / ('Scripts/python.exe' if os.name=='nt' else 'bin/python')
    if not py.is_file() or not (directory/'kokoro-v1.0.onnx').is_file() or not (directory/'voices-v1.0.bin').is_file():
        raise RuntimeError('Install Kokoro first: python3 app/scripts/local_speech.py install --engine kokoro')
    start_service('Kokoro',8880,directory,[py,APP/'scripts/kokoro_server.py','--model-directory',directory,'--port','8880'], 'kokoro-onnx')


def configure_whisper(app_url):
    # Use the app API so its live settings, backups and saved API key stay in sync.
    if not app_url.startswith(('http://127.0.0.1:', 'http://localhost:')):
        raise RuntimeError('Configuration requires a loopback app URL')
    if not healthy(8080):
        print('Whisper is not ready; set its address in Settings after starting it', flush=True)
        return
    with urllib.request.urlopen(app_url + '/api/bootstrap', timeout=10) as response:
        settings = json.load(response)['settings']
    if settings.get('whisperUrl'):
        return
    settings['whisperUrl'] = 'http://127.0.0.1:8080/inference'
    request = urllib.request.Request(app_url + '/api/settings', data=json.dumps(settings).encode(), headers={'Content-Type':'application/json'}, method='POST')
    with urllib.request.urlopen(request, timeout=10) as response:
        response.read()
    print('Local Whisper connected to English', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['install','start','configure'])
    parser.add_argument('--engine',choices=['all','whisper','kokoro'],default='all')
    parser.add_argument('--accelerator',choices=['auto','metal','cuda','cpu'],default='auto')
    parser.add_argument('--model',choices=list(MODELS),default='small.en-q5_1')
    parser.add_argument('--app-url',default='http://127.0.0.1:8790')
    args=parser.parse_args()
    if sys.version_info < (3,12):
        raise RuntimeError('Use Python 3.12+ (on Mac: brew install python@3.12)')
    if args.action=='install':
        if args.engine in ('all','whisper'):install_whisper(args)
        if args.engine in ('all','kokoro'):install_kokoro()
    elif args.action=='configure':
        configure_whisper(args.app_url)
    else:
        if args.engine in ('all','whisper'):start_whisper()
        if args.engine in ('all','kokoro'):start_kokoro()


if __name__=='__main__':
    try:main()
    except (OSError,ValueError,RuntimeError,subprocess.CalledProcessError) as error:
        print(str(error),file=sys.stderr)
        sys.exit(1)

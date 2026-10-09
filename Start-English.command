#!/bin/bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")/app"
python_command="${ENGLISH_PYTHON:-}"
if [ -z "$python_command" ]; then
  for candidate in /opt/homebrew/opt/python@3.12/bin/python3.12 /usr/local/opt/python@3.12/bin/python3.12 "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3" python3.12 python3; do
    if "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)' 2>/dev/null; then python_command="$candidate"; break; fi
  done
fi
if [ -n "$python_command" ]; then
  "$python_command" scripts/local_speech.py start --engine whisper || true
  "$python_command" scripts/local_speech.py start --engine kokoro || true
  if [ -x data/local-pronunciation/venv/bin/python ]; then "$python_command" scripts/local_speech.py start --engine pronunciation || true; fi
else
  echo 'Для Whisper и озвучки установи Python 3.12: brew install python@3.12'
fi
app_addr="${ENGLISH_ADDR:-127.0.0.1:8790}"
app_url="http://$app_addr"
if curl --fail --silent --max-time 2 "$app_url/api/bootstrap" >/dev/null; then
  if [ -n "$python_command" ]; then "$python_command" scripts/local_speech.py configure --app-url "$app_url" || true; fi
  open "$app_url"
  exit 0
fi
if ! command -v go >/dev/null; then echo 'Установи Go 1.25 или новее: https://go.dev/dl/'; exit 1; fi
# This checkout owns its binary and PID. Never stop processes by their name.
mkdir -p data/launcher
go build -mod=readonly -o data/launcher/english ./cmd/english
nohup data/launcher/english -addr "$app_addr" >data/launcher/english.stdout.log 2>data/launcher/english.stderr.log </dev/null &
echo "$!" >data/launcher/english.pid
for attempt in {1..60}; do
  if curl --fail --silent --max-time 2 "$app_url/api/bootstrap" >/dev/null; then
    if [ -n "$python_command" ]; then "$python_command" scripts/local_speech.py configure --app-url "$app_url" || true; fi
    open "$app_url"
    exit 0
  fi
  sleep .5
done
echo 'Приложение не открылось. Посмотри app/data/launcher/english.stderr.log.'
exit 1

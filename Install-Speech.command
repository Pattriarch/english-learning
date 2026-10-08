#!/bin/bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")"
python_command="${ENGLISH_PYTHON:-}"
if [ -z "$python_command" ]; then
  for candidate in /opt/homebrew/opt/python@3.12/bin/python3.12 /usr/local/opt/python@3.12/bin/python3.12 "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3" python3.12 python3; do
    if "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)' 2>/dev/null; then python_command="$candidate"; break; fi
  done
fi
if [ -z "$python_command" ]; then echo 'Установи Python 3.12: brew install python@3.12'; exit 1; fi
"$python_command" app/scripts/local_speech.py install "$@"
echo 'Готово. Открой Start-English.command.'

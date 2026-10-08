#!/bin/bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")"
codex_bin="${ENGLISH_CODEX_BIN:-}"
if [ -z "$codex_bin" ]; then codex_bin="$(command -v codex || true)"; fi
if [ -z "$codex_bin" ]; then
  for candidate in /Applications/Codex.app/Contents/Resources/codex /Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex /Applications/ChatGPT.app/Contents/Resources/codex; do
    if [ -x "$candidate" ]; then codex_bin="$candidate"; break; fi
  done
fi
if [ -z "$codex_bin" ]; then echo 'Установи Codex CLI: npm install -g @openai/codex'; exit 1; fi
"$codex_bin" login
"$codex_bin" login status
echo 'Теперь выбери «Мой аккаунт ChatGPT · Codex» в настройках English и нажми «Проверить подключение».'

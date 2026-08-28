#!/bin/bash
set -euo pipefail

# Каталог самого скрипта — чтобы uninstall.sh работал из любого места.
CARDS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.pattriarch.englishd.plist"

# Снимаем агент; если он не был загружен — не беда.
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"

echo "launchd-агент com.pattriarch.englishd снят, plist удалён."
echo "нетронуто: $CARDS_DIR/data/ (журнал, картинки, лог) и бинарник $CARDS_DIR/englishd."
echo "если это лишнее — удали руками."

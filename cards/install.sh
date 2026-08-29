#!/bin/bash
set -euo pipefail

# Каталог самого скрипта — чтобы install.sh работал из любого места.
CARDS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY="$CARDS_DIR/englishd"
PLIST="$HOME/Library/LaunchAgents/com.pattriarch.englishd.plist"
LOG="$CARDS_DIR/data/englishd.log"

cd "$CARDS_DIR"

# Сборка.
echo "собираю englishd..."
go build -o englishd .

if [ ! -f "$CARDS_DIR/config.json" ]; then
  cp "$CARDS_DIR/config.example.json" "$CARDS_DIR/config.json"
  echo "создан config.json"
fi

# Доступ к Claude — либо OAuth-профиль от `ant auth login`, либо ключ в конфиге
# или окружении. Без любого из них демон выйдет на старте.
NEED_AUTH=1
if [ -d "$HOME/.config/anthropic" ] && [ -n "$(/bin/ls -A "$HOME/.config/anthropic" 2>/dev/null)" ]; then
  NEED_AUTH=0
elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  NEED_AUTH=0
elif grep -q '"anthropic_api_key"[[:space:]]*:[[:space:]]*"[^"]\+"' "$CARDS_DIR/config.json"; then
  NEED_AUTH=0
fi

mkdir -p "$CARDS_DIR/data" "$CARDS_DIR/inbox" "$HOME/Library/LaunchAgents"

# launchd-агент: демон стартует при логине и поднимается после падения.
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.pattriarch.englishd</string>
	<key>ProgramArguments</key>
	<array>
		<string>$BINARY</string>
	</array>
	<key>WorkingDirectory</key>
	<string>$CARDS_DIR</string>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>$LOG</string>
	<key>StandardErrorPath</key>
	<string>$LOG</string>
</dict>
</plist>
PLIST_EOF

# Без доступа к Claude демон выходит с ошибкой на старте, а KeepAlive поднимал
# бы его заново каждые 10 секунд. Поэтому агент грузим только когда доступ есть.
if [ "$NEED_AUTH" = "1" ]; then
  echo
  echo "агент пока НЕ запущен — нет доступа к Claude."
  echo "дальше:"
  echo "  1. вход по аккаунту, без ключа на диске:"
  echo "       brew install anthropics/tap/ant"
  echo "       ant auth login"
  echo "     (или, если предпочитаешь ключ, впиши anthropic_api_key в $CARDS_DIR/config.json)"
  echo "  2. картинки на карточках: ключ с unsplash.com/developers в unsplash_access_key"
  echo "     необязателен — без него карточки просто будут без картинок"
  echo "  3. поставь аддон AnkiConnect: Anki → Tools → Add-ons → Get Add-ons → код 2055492159,"
  echo "     потом перезапусти Anki"
  echo "  4. запусти ./install.sh ещё раз — тогда демон стартует"
  exit 0
fi

# Переустановка: сначала снимаем старый агент, если он висит.
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo
echo "готово, демон запущен. дальше:"
echo "  1. поставь аддон AnkiConnect, если ещё нет: Anki → Tools → Add-ons → Get Add-ons → код 2055492159, потом перезапусти Anki"
echo "  2. кидай скриншоты в $CARDS_DIR/inbox/"
echo "  3. журнал карточек: http://localhost:8787"
echo
echo "лог: $LOG"

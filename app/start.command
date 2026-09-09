#!/bin/bash
set -e
cd "$(dirname "$0")"

if [ -x ./english ]; then
  exec ./english
fi

if ! command -v go >/dev/null 2>&1; then
  echo "Go не найден. Поставь: brew install go"
  read -r -p "Enter чтобы закрыть"
  exit 1
fi

exec go run ./cmd/english

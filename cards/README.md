# English Cards

## Что делает

Демон `englishd` следит за папкой `inbox/`. Кидаешь туда скриншот с английской
фразой — он сам распознаёт фразу через Claude (vision), переводит её, сочиняет
пример с переводом, подбирает картинку на Unsplash и создаёт карточку в Anki
(колода `English`, тип Basic: фраза и пример на лице, перевод и картинка на
обороте). Обработанный скрин уезжает в `inbox/processed/`, нераспознанный — в
`inbox/failed/`, а весь ход дела виден в журнале на `localhost:8787`.

## Установка

1. Нужен Go (1.25+): `brew install go`.
2. Поставь аддон AnkiConnect: Anki → Tools → Add-ons → Get Add-ons → код
   **2055492159** → OK, затем **перезапусти Anki**. Без него карточки создавать
   некому.
3. Возьми два ключа:
   - `anthropic_api_key` — https://console.anthropic.com (API Keys);
   - `unsplash_access_key` — https://unsplash.com/developers (New Application,
     нужен Access Key).
4. Запусти установку:

   ```sh
   ./install.sh
   ```

   Скрипт соберёт бинарник, создаст `config.json` из `config.example.json` и
   поставит launchd-агент (автозапуск при логине). Впиши оба ключа в
   `config.json` — и всё.

## Как пользоваться

- Кидай скриншот (PNG/JPG/WebP) в `inbox/`.
- Через несколько секунд карточка появляется в колоде **English** в Anki.
- Журнал последних карточек: http://localhost:8787 — там видно фразу, перевод,
  миниатюру и статус, оттуда же можно удалить карточку или переобработать
  упавший скрин.

**Anki должен быть открыт**, иначе карточке некуда лечь. Если Anki закрыт,
запись висит в статусе `pending` — Claude заново не вызывается, всё уже
разобрано и лежит в журнале. Как только Anki откроешь, демон сам дожмёт
отложенные записи (проверка раз в минуту).

## Где лог

`data/englishd.log` — туда пишется весь вывод демона.

```sh
tail -f data/englishd.log
```

## Как поменять колоду или модель

В `config.json`: `deck` — имя колоды в Anki, `model` — модель Claude. Там же
`journal_port`, `inbox_dir`, `data_dir` и `ankiconnect_url`. После правки:

```sh
launchctl unload ~/Library/LaunchAgents/com.pattriarch.englishd.plist
launchctl load ~/Library/LaunchAgents/com.pattriarch.englishd.plist
```

## Как удалить

```sh
./uninstall.sh
```

Снимает автозапуск и удаляет plist. Папку `data/` (журнал, картинки, лог) и
бинарник не трогает — если они не нужны, удали руками.

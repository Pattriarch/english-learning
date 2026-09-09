# ENGLISH OUTPUT TRAINER — дизайн

Дата: 2026-08-29. Автор архитектуры: Fable. Реализация: Opus-агенты под ревью.

## Что это

Личная система тренировки **Output English (американский)** из двух частей:

1. **Telegram-бот** — ежедневное письмо на английском (незнакомое можно вставлять по-русски).
   Бот (через Claude API) разбирает: ошибки → привязка к темам справочника, «можно сказать
   лучше» → натуральный AmE, карточки → очередь Anki. Копит статистику **использования** тем.
2. **Сайт-тренажёр** — справочник тем по оглавлениям реальных книг (Murphy EGiU 145 юнитов +
   тематические Phrasal Verbs / Collocations / Vocabulary in Use) с упражнениями в 5 форматах.
   Копит статистику **изучения** тем.

Два прогресса РАЗНЫЕ и показываются рядом: «изучил» ≠ «применяю в письме».

Всегда American English: орфография (color, center), лексика (apartment, vacation, fall),
+современный сленг и разговорные фразы вплетены в контент.

## Стек

- Go 1.25, один бинарь `cmd/english`: HTTP-сервер (сайт+API) + Telegram-бот (long polling,
  включается если задан `TELEGRAM_TOKEN`). Телеграм — голый Bot API через net/http, без тяжёлых SDK.
- SQLite: `modernc.org/sqlite` (без cgo). Файл `data/english.db`.
- Разбор писем — два взаимозаменяемых провайдера за интерфейсом `bot.Analyzer`:
  - **`cli` (по умолчанию)** — запуск локального бинаря `claude -p`, работает на подписке
    Claude Code, ключ не нужен. Флаги `--system-prompt --exclude-dynamic-system-prompt-sections
    --restricted --strict-mcp-config --setting-sources '' --allowedTools ''` срезают всё, что
    Claude Code грузит для интерактивной сессии: без них каждый вызов тащит ~30k лишних токенов
    (с ними ~3.3k). Ответ приходит обёрткой `{"result": "<текст модели>"}`, её разворачивает
    `cliResult`, дальше обычный `ParseAnalysis`.
  - **`api`** — HTTP `api.anthropic.com`, требует `ANTHROPIC_API_KEY`.
  Выбор через `LLM_PROVIDER`, модель через `CLAUDE_MODEL` (для cli — алиас `sonnet`).
- Фронт: vanilla JS SPA, без сборки. Раздаётся через `os.DirFS(WEB_DIR)`, не embed —
  чтобы править на живую без пересборки бинаря.
- Конфиг: `.env` (пример в `.env.example`), порт по умолчанию 8777.

## Структура папки `app/`

```
app/
  go.mod                    # module english/app
  cmd/english/main.go
  internal/store/           # sqlite: schema.sql + queries
  internal/llm/             # claude api client + промпты разбора письма
  internal/bot/             # telegram long polling, команды, диалог
  internal/anki/            # TSV экспорт
  internal/web/             # http api handlers + раздача web/
  web/                      # index.html, app.js, styles.css, форматы упражнений
  content/topics.json       # каталог тем
  content/lessons/<id>.json # уроки
  data/                     # db (gitignored)
  docs/DESIGN.md            # этот файл
  README.md
```

## Модель данных (SQLite)

```sql
-- каталог грузится из content/topics.json при старте (upsert по id)
CREATE TABLE topics (
  id TEXT PRIMARY KEY,        -- 'egiu-007', 'phrasal-015', 'slang-smalltalk'
  book TEXT NOT NULL,         -- 'egiu' | 'essential' | 'phrasal' | 'colloc' | 'vocab' | 'slang'
  unit TEXT,                  -- номер/код юнита в книге, '' если сборная тема
  category TEXT NOT NULL,     -- 'Present and past', 'Modals', 'Work', ...
  title TEXT NOT NULL,        -- 'Present perfect 1 (I have done)'
  title_ru TEXT NOT NULL,     -- короткое русское пояснение
  level TEXT NOT NULL         -- 'A2'|'B1'|'B2'|'C1'
);

CREATE TABLE letters (        -- письма из бота
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,
  prompt TEXT NOT NULL,       -- тема дня
  original TEXT NOT NULL,     -- что прислал юзер
  analysis_json TEXT NOT NULL -- полный ответ разбора (см. схему ниже)
);

CREATE TABLE topic_events (   -- сырьё обоих прогрессов
  id INTEGER PRIMARY KEY,
  topic_id TEXT NOT NULL,
  kind TEXT NOT NULL,         -- 'letter_error' | 'letter_ok' | 'ex_pass' | 'ex_fail' | 'theory_read'
  letter_id INTEGER,          -- для letter_*
  detail TEXT,                -- фраза-пример
  created_at TEXT NOT NULL
);

CREATE TABLE anki_cards (
  id INTEGER PRIMARY KEY,
  front TEXT NOT NULL,        -- RU или ситуация
  back TEXT NOT NULL,         -- натуральный AmE
  note TEXT,                  -- пояснение/тема
  topic_id TEXT,
  exported_at TEXT,           -- NULL = в очереди
  created_at TEXT NOT NULL
);

CREATE TABLE lesson_progress (
  topic_id TEXT NOT NULL,
  scene_idx INTEGER NOT NULL, -- докуда дошёл в уроке
  score_json TEXT NOT NULL,   -- {passed, failed, streakBest, done}
  updated_at TEXT NOT NULL,
  PRIMARY KEY (topic_id)
);
```

**Прогресс использования** (из писем): по topic_events kind=letter_*. Статус темы:
`unknown` (нет событий) / `struggling` (ошибки ≥2 за 30 дней) / `shaky` (есть и ошибки и ok) /
`active` (ok ≥3, ошибок 0 за 30 дней). Считается на лету запросом, не хранится.

**Прогресс изучения** (из тренажёра): по topic_events kind=ex_* + lesson_progress:
`untouched` / `started` / `completed` (урок пройден) / `mastered` (пройден с точностью ≥85%).

## Схема разбора письма (LLM output, строгий JSON)

```json
{
  "corrected": "полный исправленный текст письма, AmE",
  "errors": [{
    "quote": "кусок из оригинала",
    "fix": "как надо",
    "explain_ru": "коротко почему, по-русски",
    "topic_id": "egiu-013"
  }],
  "upgrades": [{
    "quote": "и так правильно, но",
    "better": "так скажет американец",
    "why_ru": "звучит натуральнее потому что ..."
  }],
  "russian_inserts": [{
    "ru": "что юзер написал по-русски",
    "en": "натуральный AmE перевод",
    "alt": "разговорный вариант/сленг если есть"
  }],
  "slang_bonus": {"phrase": "no cap", "meaning_ru": "...", "example": "..."},
  "topics_ok": ["egiu-092"],
  "cards": [{"front": "...", "back": "...", "note": "...", "topic_id": "..."}]
}
```

`topics_ok` — темы, применённые в письме ПРАВИЛЬНО (не пересекается с errors). Без этого поля
статус `active` недостижим: неоткуда взять событие `letter_ok`.

Промпт разбора получает каталог тем (id+title, компактно) для привязки topic_id.
errors + russian_inserts автоматически становятся anki_cards; upgrades — по кнопке.

## Telegram-бот (личный, один юзер — проверка chat_id по env `TELEGRAM_CHAT_ID`, если задан)

- `/write` — выдать тему дня (ротация из пула ~60 промптов: письмо другу, жалоба, ревью кода,
  пост, объяснение решения — рабоче-жизненные, не школьные) и ждать письмо.
- Любой текст ≥ 200 символов вне команд — тоже считается письмом (разбор без темы).
- Ответ разбора: исправленный текст, затем ошибки списком `цитата → фикс — почему [тема]`,
  затем «🔥 Сильнее:» апгрейды, затем переводы русских вставок, затем сленг-бонус.
  Плюс строка «N карточек в очереди Anki». HTML-разметка Telegram.
- `/anki` — прислать файл TSV (front/back/note) со всей очередью, пометить exported.
- `/stats` — топ слабых тем (struggling), стрик писем, ссылка на сайт с темой.
- `/topics` — краткий статус: сколько active/shaky/struggling/unknown.

## HTTP API (для SPA)

```
GET  /api/topics                 -> [{topic, usage_status, study_status, counts, has_lesson}]
GET  /api/topics/{id}            -> topic + events за 90 дней + has_lesson, has_progress, progress
GET  /api/lessons/{topicId}      -> lesson json (404 если нет — фронт покажет "урок не создан")
POST /api/progress               -> {topicId, sceneIdx, event, detail, score?} -> новый статус темы
GET  /api/letters                -> список писем с разборами
GET  /api/anki/export.tsv        -> очередь карточек TSV (+пометить exported)
GET  /api/stats                  -> сводка для дашборда
```

`score` — свободный блоб `{passed, failed, streakBest, done}`, хранится в lesson_progress.
Бэкенд не знает числа сцен в уроке, поэтому «урок пройден» объявляет фронт: `done: true`
на последней сцене. Без него тема не станет `completed`/`mastered`.

**usage_status, точные правила** (порядок проверки): нет letter-событий → `unknown`;
ошибок ≥2 за 30 дней → `struggling`; ok ≥3 и ошибок 0 → `active`; иначе → `shaky`.

## Формат урока (content/lessons/<topicId>.json)

Урок = последовательность сцен. Каждая сцена — один из 5 форматов. Движок фронта рендерит
по `type`. Уроки миксуют форматы (2–4 сцены разных типов на урок).

```json
{
  "topicId": "egiu-013",
  "title": "...", 
  "theory": "markdown: выжимка правила, AmE-примеры, частые русскоязычные грабли",
  "scenes": [ {"type": "case|thread|dub|radar|letter", ...} ]
}
```

### 5 форматов подачи

1. **`case` — «Дело №…»** (детектив, Simpler-style). Сюжет: детектив Мия Торрес, Чикаго.
   Шаги: `[{text_ru_en: "нарратив с репликами героев", question, choices[], answer, clue_ru:
   "почему грамматика раскрывает ложь"}]`. Грамматика = улика: подозреваемый сказал
   "I've seen her yesterday" — время выдаёт враньё.
2. **`thread` — «Тред»** (фейк-мессенджер). Переписка в стиле iMessage/Slack с коллегой/другом.
   Шаги: собеседник пишет → выбор из 3 реплик (одна натуральная AmE, одна грамматически
   кривая, одна «учебниковая» неестественная) или свободный ввод. Сленг живёт здесь.
3. **`dub` — «Дубляж»**. Ты переводчик сцены сериала. Дана ситуация + русская реплика →
   печатаешь английскую → сравнение с эталоном (fuzzy: показать эталон, отметить совпало/нет,
   самооценка «совпал/близко/мимо») + разбор почему так.
4. **`radar` — «Радар»**. Блиц 10–15 карточек, таймер 7 сек: фраза → свайп/кнопки
   «✓ звучит по-американски» / «✗ не звучит». В пуле: ошибки, британизмы, кальки с русского.
   Комбо-счётчик. После каждой — вспышка-объяснение одной строкой.
5. **`letter` — «Чужое письмо»**. Письмо персонажа с 6–10 спрятанными ошибками ровно по теме
   урока. Кликаешь подозрительные куски → верно/нет → в конце раскрытие всех + исправленная
   версия.

### Стиль контента (обязательный, «не ИИшно»)

- Живые персонажи со сквозной жизнью (детектив Мия, коллега-техлид Джейк, сосед Дэнни…),
  конкретика: названия улиц, суммы, время. Никаких "John went to the store".
- Юмор сухой, без восклицательной бодрости. Запрещены: "Let's dive in!", "Awesome!",
  "In this lesson you will learn…".
- Русский текст интерфейса/пояснений — разговорный, короткий, на «ты».
- AmE строго: проверять орфографию и лексику. Британизмы появляются ТОЛЬКО как
  неправильные варианты в radar с пометкой.
- Сленг: актуальный (bet, no cap, lowkey, mid, cooked, "it's giving…", rizz — с пометкой
  уместности: с кем можно, с кем нельзя) + фразовые глаголы из книг.

## Каталог тем (content/topics.json)

- Все 145 юнитов EGiU (из реального оглавления, файл toc/egiu.txt) → id `egiu-001..145`,
  категории из книги, уровень B1/B2.
- Тематические юниты из Collocations Int + Vocab Upper-Int + Phrasal Verbs (выборочно,
  ~40 самых полезных для работы/жизни тем) → `colloc-*`, `vocab-*`, `phrasal-*`.
- +8 сборных тем сленга/разговорного (`slang-*`): smalltalk, реакции, работа/IT, планы и отказы…
- Итого ~190 тем в каталоге. Уроки создаются постепенно; на старте — 12 уроков
  (частые боли рус. спикеров: артикли, present perfect vs past, will/going to, условные,
  предлоги времени/места, sequence of tenses, фразовые up/out, smalltalk-сленг…).

## Порядок реализации (Opus-агенты, Fable ревьюит каждый шаг)

1. `backend` — Go: store, llm, anki, bot, web api, main. Компилится, юниты на store и anki.
2. `frontend` — SPA: дашборд (2 прогресса), каталог, страница темы (теория+урок),
   движок 5 форматов, экраны писем.
3. `catalog` — topics.json из toc-файлов.
4. `content` — 12 уроков по эталону Fable (эталонный урок пишет Fable).
5. Интеграция, сборка, smoke-тест, README.

## Не делаем (YAGNI)

- Мультиюзер, авторизация, деплой в облако — бот крутится на маке (`start.command`).
- AnkiConnect — пока только TSV (импорт руками), добавим если попросит.
- Спич/аудио, мобильное приложение.

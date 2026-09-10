# American English в авторских курсах: аудит и миграция

Дата: 10 сентября 2026. Область: `content/curriculum.json` и пять файлов `content/courses/*.json`, всего **211 обычных уроков**. Книжные `content/book-lessons`, исходные PDF/изображения, пользовательские ответы и прогресс не изменялись.

Миграция опубликована: **141 урок, 496 текстовых полей**. Это согласование авторского учебного языка с американским вариантом, а не объявление британского английского неправильным. Значения, события, числа, задания и их требования сохранены; менялись орфография, выбранная бытовая лексика, связанные английские цитаты в русских пояснениях и необходимый артикль.

## Что установлено до изменений

Ограниченный поиск по полностью английским `examples.en`, `exercises.answers`, `exercises.context` и `materials.text` нашёл 695 орфографических совпадений в 141 уроке и 117 лексических кандидатов в 55 уроках. Всего затронуто поиском 151 различный урок. Эти числа **не означают количество ошибок**: `lift` как глагол, `flat` о поверхности, `support queue`, `public holidays`, региональные сравнения и названия требуют сохранения. Дополнительная проверка смешанных RU/EN полей обнаружила `organiser`, `judgement`, некоторые термины и подписи, не включённые в первоначальный узкий поиск.

Разница `practise`/`practice` подтверждена [Cambridge](https://dictionary.cambridge.org/dictionary/english/practise). Предпочтительное американское `traveling` описано [Merriam-Webster](https://www.merriam-webster.com/grammar/traveling-vs-travelling-usage); [тот же словарь](https://www.merriam-webster.com/grammar/canceled-or-cancelled) подчёркивает допустимость обоих вариантов `canceled/cancelled`, поэтому здесь применяется редакторский выбор, а не исправление «ошибки».

Бытовые различия проверены по статьям Cambridge: [flatmate](https://dictionary.cambridge.org/dictionary/english/flatmate), [lift](https://dictionary.cambridge.org/us/dictionary/english/lift), [cooker](https://dictionary.cambridge.org/us/dictionary/english/cooker) и [сравнению BrE/AmE](https://dictionary.cambridge.org/grammar/british-grammar/british-and-%2Bamerican-english). Словарные примеры в учебник не копировались.

## Применённые правила

Орфография меняется по закрытому словарю в `scripts/migrate_american_course_language.py`. В него входят проверенные формы `color`, `neighbor`, `organize`, `organizer`, `practice`, `judgment`, `catalog`, `center`, `meter`, `centimeter` и соответствующие формы других явно перечисленных слов. Это не замена любого `-ise` на `-ize`: `exercise`, `revise`, `promise`, `precise` и существительное `analyses` сохраняются. Числовые значения и единицы не переводятся в американскую систему мер: `3.0-metre` становится `3.0-meter`, а само расстояние остаётся прежним.

Лексика меняется только в явно выбранных уроках и значениях:

| Материал | Редакторское изменение |
| --- | --- |
| Авторская ситуация о ноутбуке в `cinema-bcs-s01e03-listen/respond` | `camera above the lift` → `camera above the elevator`; реплика `I'll lift it and check` сохраняется. |
| Бытовые ситуации `cinema…s01e02/s01e03`, `extended-b2-sleep` | `flatmate` → `roommate`, включая `Flatmate` в русском объяснении. |
| Выбранные рассказы о жилье A1–C1 | `flat/flats` → `apartment/apartments`; `a flat` → `an apartment`, а `a new apartment` остаётся с `a`. |
| `path-past-continuous`, `path-word-formation` | Плита в рассказе о супе: `cooker` → `stove`. Другие значения и составные названия приборов не заменяются. |
| `path-future-perfect` | `take the rubbish out` → `take the trash out`. |
| `path-adjectives-frequency` | О повторяющейся привычке: `at the weekend` → `on weekends`. |
| `cinema-bcs-s01e07-prepare` | В собственном рассказе об отпуске: `during my holiday` → `during my vacation`. |
| `extended-c2-literary` | В авторском рассказе: `boot of her car` → `trunk of her car`, `waistcoat` → `vest`; шкаф `cupboard` и глагол `lift` сохраняются. |

## Сохранённые исключения

**16 уроков сохранены целиком**: `extended-a1-notices`, `extended-a1-order`, `extended-a2-options`, `extended-a2-service`, `extended-b1-review`, `extended-b2-evidence`, `extended-b2-negotiate`, `extended-c1-lecture`, `extended-c1-cross-text`, `extended-c1-facilitation`, `extended-c2-synthesis`, `extended-c2-editor`, `extended-c2-register-performance`, `extended-c1-conversion`, `extended-b2-reference-letter`, `research-ordering-checkout`.

У этих уроков есть явные причины: британская нумерация этажей; заданный редакционный стандарт British `-ise`; британская рабочая ситуация; различие значений глагола `table`; сценарии с ценами и ограничениями в фунтах стерлингов. Сохранены сравнительные абзацы других уроков, формулировки с `pounds`, ссылки и собственные названия `Neighbour Link`, `River Centre`, `Greenbridge Language Centre`, `Harbour Museum` и другие. У `extended-b2-sleep` ссылки на NHS и упоминания GP не превращены в утверждения об американской системе здравоохранения.

Поэтому текущий результат не называется «все 211 уроков исключительно American English». Американский вариант является целью авторской практики; распознавание британских источников и работа с явно заданным британским стилем остаются частью курса.

## Проверка и границы ручной вычитки

Root полностью прочитал 45 первоначально отобранных лексических полей и весь скрипт правил/сохранения/публикации. По этой проверке исправлены согласование артикля и регистра `Flatmate`, добавлены точечные `vacation`, `trunk`, `vest` и дополнительные орфографические формы. Агент book_text_layout отдельно прочитал первоначальный скрипт, затем переключился на TTS; его чтение не представляется полной вычиткой всех текстов. Исполнитель просмотрел все группы фактических замен и неоднозначные исходные контексты. **496 полей не заявляются как 496 независимо прочитанных целых текстов.**

Проверено после публикации:

- 8 regression tests миграции: закрытый whitelist, имена/URL, неоднозначные `lift/flat`, артикли, регистр слова, British-сравнения, неизменность ID и повторное применение редакторских коррекций.
- 4 проверки генератора extended на временных тестовых данных, без вызова провайдера.
- Все 44 extended-урока проходят исходный валидатор и совпадают с текущими spec hashes; копии в `data/extended-lessons` совпадают с публикацией, SHA объектов согласованы с release.
- Все 211 lesson IDs, exercise IDs/kinds/materialIds и material IDs/kinds сохранены. Все 16 защищённых уроков объектно совпадают с резервными копиями. Все 496 полей совпадают со своими receipts, проверены SHA шести опубликованных файлов.
- `go test -mod=readonly ./internal/studio -run 'TestCurriculumComplete|TestExtendedCourse|TestLessonMaterial' -count=1` — PASS. Обычный запуск без `-mod=readonly` столкнулся с существующим inconsistent vendor; содержимое vendor не менялось.
- После обновления озвучки root независимо проверил **148/148 текущих материалов**: непустой PCM, точный SHA текста, имя WAV по хешу голоса и текста, `culture: en-US`; ошибок 0. Receipt: `data/american-course-migration/audio-verification.json`. Это техническая сверка записи и текста, а не утверждение о ручном прослушивании каждой записи.

## Артефакты публикации

- `content/american-course-migration.json`: полный before/after каждого поля, SHA полей и шести файлов, причины исключений, изменённые audio inputs. SHA файла: `97c3cfbd881fdda9e61a3af0177e933ece1e4309f665a1b0f797788b2c5828bf`.
- Резервная копия исходных шести JSON, прежнего manifest коррекций и release: `data/american-course-migration/20260910T160042201459Z`.
- `data/american-course-migration/audio-inputs.json`: изменены **46 материалов в 23 уроках** и **36 примеров** для озвучивания по запросу. Подготовленную озвучку root обновил и проверил отдельно; сам скрипт миграции аудио не синтезирует.
- `data/american-course-migration/review-deltas.json`: компактные группы замен для повторной редакторской проверки.
- Штатный `finalize_extended_course.py` обновил publication и исправления: **44 модуля, 148 материалов, 352 задания**. SHA release-файла на этом рубеже: `a30d26a460411166dcef7e57cfc343999f9a6242b40078df091c1539ea0a81c3`.

Старые приватные baseline-инвентари и model-response caches остаются историей исходного авторинга. Их исходные source hashes не переписаны задним числом: они должны препятствовать слепому повторному применению старых ответов поверх изменённого учебного источника. Рабочее приложение использует опубликованные JSON; эти исторические кеши не являются текущими уроками.

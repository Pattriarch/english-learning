# English

Мастерская американского английского A1–C2: 211 подготовленных занятий, все 872 уникальных книжных урока, кинокурс Better Call Saul и шесть дизайнов. Готовность 872/872 подтверждена строгой проверкой манифеста. Тетрадь собственных мыслей, отложенное применение изученного и контекстный словарь включены в основной интерфейс.

Из корня запустите `Start-English.cmd`. Или из этой папки:

```sh
go run -mod=readonly ./cmd/english
```

Адрес: http://127.0.0.1:8777. Прогресс: `data/studio/progress.json`.

- [Полная инструкция](docs/WORKSHOP.md)
- [Итоговая приёмка и границы проверки](docs/ACCEPTANCE-2026-09-10.md)
- [Локальное распознавание речи и установка](docs/LOCAL-ASR-2026-09-10.md)
- [Нейросетевая озвучка Kokoro и выбор голоса](docs/LOCAL-TTS-2026-09-10.md)
- [Ежедневный план и сохранение прогресса](docs/DAILY-PLAN.md)
- [Как заниматься от B1 к C2: исследование и ежедневная практика](docs/LEARNING-METHOD-RESEARCH-2026-09-10.md)
- [Применять изученное после паузы](docs/RETENTION-METHOD.md)
- [Сохранение собственных мыслей и голосовых записей](docs/NOTEBOOK-SAVING-REVIEW-2026-09-10.md)
- [Словарь: 10 188 статей, источники и границы проверки](docs/CONTEXT-LEXICON-SOURCES-2026-09-10.md)
- [Программа A1–C2](docs/LEARNING-PATH.md)
- [Аудит всех оглавлений](docs/LIBRARY-COVERAGE.md)
- [Внешний аудит программы и карта навыков](docs/EXTERNAL-CURRICULUM-AUDIT.md)
- [18 дополнительных уроков](docs/RESEARCH-LESSONS.md)
- [Чтение, транскрипция и произношение](docs/PRONUNCIATION.md)
- [Проверенные источники субтитров](docs/SUBTITLE-RESEARCH.md)
- [Кинокурс](docs/CINEMA.md)
- [Шесть дизайнов](docs/DESIGN.md)
- [Описание сохранённой старой версии](docs/LEGACY.md)

Проверки:

```sh
go test -mod=readonly ./...
go vet -mod=readonly ./internal/studio
node --test studio/tests/*.mjs
```

Дополнение по [новому исследованию](docs/CURRICULUM-RESEARCH-2026-09-10.md) и [сверке тем внешнего учебника](docs/EXTERNAL-BOOK-CROSSWALK.md) полностью выпущено: 44 модуля, 148 входных материалов, 352 задания, две диаграммы и изображение для описания. Дополнительно проверены [119 блоков оглавлений A1–B2](docs/FOUNDATION-BOOK-CROSSWALK.md). Отдельный книжный выпуск полностью готов: 872/872 главы. [Устройство и перенос расширения](docs/EXTENDED-SKILLS.md).

# B1–B2: понятные входы в уроки и исследование

Дата проверки: 20 сентября 2026. Файл: `app/content/course-guides-b1-b2.json`.

## Что подготовлено

70 из 70 авторских уроков с первым уровнем B1 или B2, кроме киноуроков: 30 основных, 19 обзорных, 14 сценарных, 6 исследовательских и 1 урок с настоящим интервью. Это 23 урока B1, 31 B2, 15 B1–B2 и 1 B2–C1.

Для каждого написаны назначение темы простыми словами, три коротких объяснения, два двуязычных примера с разбором смысла, две небольшие подготовительные задачи со словарем и образцом, переход к основному заданию и зависимости от изученных тем. Итого: 210 объясняющих блоков, 140 примеров и 140 задач. Самый длинный блок объяснения — 38 слов при подсчете по пробелам. Это ориентир читаемости, не доказательство качества объяснения.

Объяснения написаны заново, не собраны заменой названий в одном универсальном шаблоне. Существующие главы, исходные задания, материалы сценариев и их контрольные хеши этим файлом не изменены. Подключение подготовительных шагов и новый порядок выполняются отдельно в приложении.

## Что прочитано и как использовано

- BBC 6 Minute Grammar: прочитан опубликованный транскрипт Present perfect continuous. Полезен переход от конкретной ситуации к форме и сравнению процесса с результатом. В общей формуле в тексте самого транскрипта пропущено `been`; примеры содержат его. В наших объяснениях форма полная. Это причина проверять даже официальный текст, а не переносить его механически.
- British Council: прочитаны страницы Present perfect, Past perfect, Third and mixed conditionals, Passives, Future continuous and future perfect, Participle clauses и Opinion essay. В частности, Past perfect не объясняется как «любое действие раньше другого»; отделены последовательность рассказа и взгляд назад. Для mixed conditionals сначала обозначается время обеих частей.
- BBC Grammar Gameshow: прочитан транскрипт про формы после глаголов и предлогов. В курсе формы изучаются целыми короткими выражениями; отдельно раскрыта смысловая разница remember/stop/try.
- Rachel’s English: прочитан видеотранскрипт Linking and Thought Groups. Американская связная речь объясняется через смысловые группы и соединение звуков. Нет правила «всегда выкидывай t».
- British Council What to Say: прочитан видеотранскрипт Challenging someone’s ideas. Сценарии теперь предваряются языком уточнения, конкретного возражения и условного предложения.
- Reddit r/EnglishLearning: прочитано обсуждение трудности самостоятельной речи при хорошем понимании. Выделена пользовательская проблема «слова узнаю, фразу сам не строю». Отсюда решение курса: короткая собственная фраза с опорой перед длинным пересказом. Комментарии не использованы как доказательство эффективности или как грамматический авторитет.
- NASA: проверена официальная страница уже используемого интервью Leadership at All Levels. Подготовка объясняет, как передавать авторскую позицию, оговорку и назначение примера. Примеры подготовки не выдают себя за цитаты NASA.

Видео изучались по доступным транскриптам, а не заявленным «просмотром» без воспроизведения. Два недоступных адреса British Council для reported speech и complaint не использованы как прочитанные источники. Общие правила из собственного языкового знания не приписаны форуму.

## Найденные скачки и внесенные опоры

| Проблема | Что добавлено |
| --- | --- |
| Present perfect continuous сразу требует личного рассказа | Противопоставление «сейчас» и «уже час», схема have/has been, for/since, короткая репетиция |
| Обзор future включает Future perfect до отдельного изучения | Зависимость от урока результата к сроку и различение by/until |
| Обзор passive одновременно требует косвенную речь | Явная зависимость от обоих путей и отдельный разбор asked/told/said |
| Сценарий B1 начинается с аналитической записки 80–100 слов | Даны submit a request, receive confirmation, must/should/may, unless, вопрос о подтверждении и план из четырех пунктов |
| Интервью и заявки подразумевают готовый язык описания опыта | My task was to, I helped by, I was responsible for; разделение личного и командного вклада |
| Рецензия требует обсуждать устройство текста до обучения | Факт → оценка → опора → адресная рекомендация, worth visiting и for my taste |
| Отчет требует сразу большого вывода по цифрам | out of, from/to/by, denominator, проценты/процентные пункты, различение confidence/skill |
| Урок про сон допускает смешение лексики и диагноза | go to bed/fall asleep/sleep/wake up/get up, описание наблюдений без назначения причин |
| Учебные аудиосценарии можно принять за настоящее слушание | В переходах сохранен порядок звук → собственная попытка → транскрипт; текстовая альтернатива не называется аудированием |

Американский вариант используется по умолчанию: apartment/laptop/movie, canceled, organized, in the hospital. Регистровые слова stuff и messed up объяснены в ситуации, без требования вставлять сленг в деловую переписку.

Дополнительный аудит книжного входа: `book-preparation.js` теперь использует точные соответствия всех 360 глав трех грамматических каталогов (115 + 145 + 100) прежде широкой категории. В частности, Present continuous больше не открывается подсказкой о Past perfect continuous. Все ссылки на опорные уроки разрешаются. Если отдельный нюанс не имеет собственного урока, опора названа языковой основой, а не заменой главы.

## Проверки и границы

Машинная проверка сравнила весь текущий список curriculum/courses с подготовленными lessonId: пропусков и лишних уроков нет. Нет повторных ID, отсутствующих prerequisites или sourceIds; граф зависимостей этой группы не содержит циклов. У каждого урока ровно три непустых блока, два примера и две guided-задачи с ответом и поддержкой.

Эти проверки не доказывают прохождение CEFR и не заменяют дальнейшее наблюдение за тем, как ученик понимает объяснения. Книжные главы и киноуроки не входили в эту часть работы. Исходные большие задания сценариев сохранены как самостоятельный этап; подготовка делает вход понятнее, но не превращает каждую задачу B2 в упражнение A1. Ученик должен прийти к ним через указанные зависимости.

## Источники

- [British Council: Present perfect](https://learnenglish.britishcouncil.org/free-resources/grammar/b1-b2/present-perfect) — Сверка связи прошлого с настоящим. Русские объяснения и задания написаны заново.
- [BBC 6 Minute Grammar: Present perfect continuous — transcript](https://downloads.bbc.co.uk/learningenglish/intermediate/unit2/b2_u2_6min_gram_present_perfect_continuous.pdf) — Прочитан опубликованный конспект передачи: началось раньше и длится сейчас; недавний процесс с видимым результатом. В формуле в транскрипте пропущено been; в курсе исправлено.
- [British Council: Conditionals, third and mixed](https://learnenglish.britishcouncil.org/free-resources/grammar/b1-b2/conditionals-third-mixed) — Сверка времени условия и результата; примеры курса собственные, в американском варианте.
- [British Council: An opinion essay](https://learnenglish.britishcouncil.org/free-resources/writing/b2/opinion-essay) — Понятный тезис, аргумент, пример и ограничение. Не требовать длинное эссе до короткой репетиции.
- [Rachel’s English: Linking and Thought Groups — video transcript](https://rachelsenglish.com/linking-and-thought-groups/) — Прочитан транскрипт американского преподавателя: связь звуков внутри смысловой группы и пауза между группами; упражнения курса оригинальные.
- [r/EnglishLearning: I understand English but I can’t speak it](https://www.reddit.com/r/EnglishLearning/comments/1abeccx/i_understand_english_but_i_cant_speak_it/) — Прочитана дискуссия о разрыве между пониманием и самостоятельной речью. Это пользовательский опыт, не доказательство эффективности метода и не источник грамматических правил.
- [British Council: Past perfect](https://learnenglish.britishcouncil.org/free-resources/grammar/b1-b2/past-perfect) — Прочитано правило и ответы преподавателя: последовательность сама по себе не требует Past perfect; важна прошлая точка отсчета и связь событий.
- [British Council: Passives](https://learnenglish.britishcouncil.org/free-resources/grammar/b1-b2/passives) — Смена фокуса предложения и сохранение времени в форме be; собственные примеры курса.
- [BBC Grammar Gameshow: Verb patterns — transcript](https://downloads.bbc.co.uk/learningenglish/tgg/unit_7/le_TGG_Ep7_verb_patterns.pdf) — Прочитан транскрипт передачи: формы после глаголов и предлогов. В курсе дополнительно разобрана разница смыслов remember/stop/try.
- [British Council: Challenging someone’s ideas — video transcript](https://learnenglish.britishcouncil.org/sites/podcasts/files/LearnEnglish-Speaking-B2-Challenging-someones-ideas.pdf) — Прочитан транскрипт: уточнить предложение, назвать сомнение, предложить ограниченную пробу. Новые ситуации курса не копируют диалог.
- [NASA: Leadership at All Levels, episode 357](https://www.nasa.gov/podcasts/houston-we-have-a-podcast/leadership-at-all-levels/) — Проверен источник уже сохраненного интервью. Подготовка учит передавать позицию, оговорку и функцию примера, не раскрывая полный ответ до слушания.
- [British Council: Future continuous and future perfect](https://learnenglish.britishcouncil.org/free-resources/grammar/b1-b2/future-continuous-future-perfect?page=1) — Прочитано объяснение: процесс в будущий момент и результат к будущему сроку. Разница показана на собственных бытовых примерах.
- [British Council: Participle clauses](https://learnenglish.britishcouncil.org/free-resources/grammar/c1/participle-clauses) — Сверены общий субъект и письменный регистр. Простая полная фраза сохраняется как нормальная альтернатива усложнению.

- [British Council: Modals, deductions about the present](https://learnenglish.britishcouncil.org/free-resources/grammar/b1-b2/modals-deductions-about-present) — Сверено: must/can’t показывают уверенность говорящего, might/could — возможность; это не точные вероятности и не обязанность.
- [British Council: Modals, deductions about the past](https://learnenglish.britishcouncil.org/free-resources/grammar/b1-b2/modals-deductions-about-past) — Сверка формы modal + have + третья форма для предположений о прошлом; короткая опора перед разбором полной ситуации.

## Покрытые уроки

| ID | Уровень | Файл |
| --- | --- | --- |
| `path-present-perfect-continuous` | B1 | foundation.json |
| `path-past-perfect` | B1 | foundation.json |
| `path-future-continuous` | B1 | foundation.json |
| `path-second-conditional` | B1 | foundation.json |
| `path-third-conditional` | B1 | foundation.json |
| `path-passive-basic` | B1 | foundation.json |
| `path-reported-speech` | B1 | foundation.json |
| `path-polite-questions` | B1 | foundation.json |
| `path-deduction` | B1 | foundation.json |
| `path-word-formation` | B1 | foundation.json |
| `path-collocations-b1` | B1 | foundation.json |
| `path-reading-inference` | B1 | foundation.json |
| `path-connected-speech` | B1 | foundation.json |
| `path-narrative` | B1 | foundation.json |
| `path-repair-conversation` | B1 | foundation.json |
| `path-past-perfect-continuous` | B2 | foundation.json |
| `path-future-perfect` | B2 | foundation.json |
| `path-future-perfect-continuous` | B2 | foundation.json |
| `path-mixed-conditionals` | B2 | foundation.json |
| `path-modal-perfect` | B2 | foundation.json |
| `path-passive-advanced` | B2 | foundation.json |
| `path-relative-advanced` | B2 | foundation.json |
| `path-articles-advanced` | B2 | foundation.json |
| `path-participle-clauses` | B2 | foundation.json |
| `path-verb-patterns-advanced` | B2 | foundation.json |
| `path-quantifiers-nuance` | B2 | foundation.json |
| `path-critical-reading` | B2 | foundation.json |
| `path-argument-essay` | B2 | foundation.json |
| `path-discussion-b2` | B2 | foundation.json |
| `path-register-b2` | B2 | foundation.json |
| `present` | B1–B2 | curriculum.json |
| `past-story` | B1–B2 | curriculum.json |
| `perfect` | B1–B2 | curriculum.json |
| `future` | B1–B2 | curriculum.json |
| `articles` | B1–B2 | curriculum.json |
| `questions` | B1–B2 | curriculum.json |
| `passive` | B1–B2 | curriculum.json |
| `verb-patterns` | B1–B2 | curriculum.json |
| `prepositions` | B1–B2 | curriculum.json |
| `collocations` | B1–B2 | curriculum.json |
| `phrasal` | B1–B2 | curriculum.json |
| `word-building` | B1–B2 | curriculum.json |
| `writing` | B1–B2 | curriculum.json |
| `speaking` | B1–B2 | curriculum.json |
| `listening` | B1–B2 | curriculum.json |
| `modals` | B2 | curriculum.json |
| `conditionals` | B2 | curriculum.json |
| `linking` | B2 | curriculum.json |
| `comparison` | B2 | curriculum.json |
| `extended-b1-procedure` | B1 | extended-skills.json |
| `extended-b1-interview` | B1 | extended-skills.json |
| `extended-b1-listening` | B1 | extended-skills.json |
| `extended-b1-review` | B1 | extended-skills.json |
| `extended-b1-online-help` | B1 | extended-skills.json |
| `extended-b2-evidence` | B2 | extended-skills.json |
| `extended-b2-negotiate` | B2 | extended-skills.json |
| `extended-b2-interview` | B2 | extended-skills.json |
| `extended-b2-essay-thread` | B2 | extended-skills.json |
| `extended-b2-application` | B2 | extended-skills.json |
| `extended-b2-regret-emphasis` | B2 | extended-skills.json |
| `extended-b2-sleep` | B2 | extended-skills.json |
| `extended-b2-remote-project` | B2 | extended-skills.json |
| `extended-b2-reference-letter` | B2 | extended-skills.json |
| `research-connected-boundaries` | B1 | research-expansion.json |
| `research-listening-decoding` | B1 | research-expansion.json |
| `research-review-writing` | B1 | research-expansion.json |
| `research-complaint-resolution` | B2 | research-expansion.json |
| `research-report-data` | B2 | research-expansion.json |
| `research-application-interview` | B2 | research-expansion.json |
| `natural-b2-leadership` | B2–C1 | natural-listening.json |

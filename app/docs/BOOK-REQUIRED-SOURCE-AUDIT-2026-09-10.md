# Проверка обязательных источников в книжных заданиях

Дата: 2026-09-10. Автоматически просмотрены prompts 617 готовых книжных уроков. Поиск ссылок на запись, видео, фотографию, статью, таблицу, график и исходный текст дал 19 кандидатов. **Все 19 вручную проверены вместе с контекстом; обязательных отсутствующих источников в этой выборке не найдено.**

Совпадения в основном относятся к теме готового текста для перевода или к полностью заданной воображаемой ситуации. В grammar-intermediate-048/e5 все три исходные реплики буквально даны в prompt. В vocabulary-upper-intermediate-001/e6 требуется предложить будущий недельный план, а не сначала найти и изучить неопределённый материал.

Уроки не изменялись. Решения хранятся в приватном book-required-sources-review.json и связаны с SHA256 prompt+context: при изменении этих полей отметка перестаёт применяться. Повторный аудит обязателен после завершения очереди; отсутствие regex-совпадения не доказывает самодостаточность всех 872 уроков.

| Unit / exercise | Решение |
|---|---|
| `collocations-advanced-033/e4` | The schedule is a given contractual fact, not a missing graph. The source message, payment900 and remaining debt facts are supplied. |
| `collocations-intermediate-002/e5` | The entire source message and all replacement facts are quoted in the prompt; no external text is required. |
| `collocations-intermediate-050/e3` | Photography is the topic of a complete Russian message to translate; no picture is needed. |
| `collocations-intermediate-056/e8` | The task asks for an opinion on recording future classes, not watching an existing video. Both sides are given in context. |
| `grammar-advanced-013/e1` | The schedule appears inside the complete Russian message; dates and prediction are given. |
| `grammar-advanced-025/e4` | The two sentences to transform are fully quoted. Context explains the supplier as continuing topic without requiring an actual preceding article. |
| `grammar-advanced-049/e3` | The entire conclusion from the imagined memo is quoted for translation; no memo is needed. |
| `grammar-advanced-055/e3` | The catalogue passage is fully quoted for translation, including facts and1820; no maps or historian notes need to be accessed. |
| `grammar-elementary-053/e7` | Photography is the topic of an imagined report; all four required events and verbs are supplied. |
| `grammar-intermediate-009/e2` | Photography classes appear inside the complete message to translate; no photograph is required. |
| `grammar-intermediate-019/e6` | The work schedule and all appointments are explicitly given. The learner invents one question about the cafe hours; no actual cafe research is required. |
| `grammar-intermediate-034/e2` | Taking notes is an event inside the quoted message to translate, not a source request. |
| `grammar-intermediate-035/e2` | The table error is a supplied fact inside the full message to translate; the table itself is not used. |
| `grammar-intermediate-048/e5` | All three original utterances, including the condition, are quoted directly in the prompt. No audio recording is requested. |
| `phrasal-advanced-025/e7` | Preparation of a photography class is a writing scenario; the required actions and reasons are specified. |
| `phrasal-advanced-047/e1` | The full warning is quoted for translation. Photographing animals is mentioned as an action visitors should avoid, not as a required learner action. |
| `vocabulary-advanced-001/e5` | The old course description and replacement assessment requirements are supplied; the task does not require actual photos or a research project. |
| `vocabulary-upper-intermediate-001/e6` | The learner proposes a future weekly practice plan, including source types; completing this writing task does not require finding or consuming an unspecified source. |
| `vocabulary-upper-intermediate-010/e2` | The photograph is mentioned in a full Russian message to translate. The user does not need to view it. |

## Найденное и исправленное отсутствующее изображение

При следующем проходе 619 уроков появился 20-й кандидат: grammar-intermediate-064/e6 просил спросить о приборе на фотографии комнаты, но фотография отсутствовала. После согласования с root ссылка на неё удалена. В context помещены полностью авторское вымышленное объявление и все условия: экран, неизвестный прибор рядом, собеседование в четверг, тихое место, надёжная связь, 20 минут на подготовку и вопрос о двери. Цель What ... for? и все правильные образцы сохранены. Записана editorial revision с before/after; source/image hashes не менялись, глубокая проверка пройдена, canonical/static идентичны.

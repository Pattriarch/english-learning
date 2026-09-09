// Мок-урок: все 5 типов сцен по content/LESSON_SCHEMA.md.
// Используется только в режиме ?mock=1.

export const mockLesson = {
  topicId: 'egiu-013',
  title: 'Present perfect vs past simple',
  title_ru: 'уже сделал vs сделал тогда',
  theory: [
    '## Коротко',
    '',
    'Past simple привязан к **закончившемуся** отрезку времени: `yesterday`, `last week`,',
    '`in 2019`, `at 6`. Present perfect — про **сейчас**: результат виден, время не названо',
    'или отрезок ещё идёт (`today`, `this week`, `so far`).',
    '',
    '- `I lost my keys.` — факт из прошлого, ключи могли найтись.',
    '- `I\'ve lost my keys.` — ключей нет прямо сейчас, это проблема.',
    '',
    '## Где спотыкаются русскоязычные',
    '',
    '1. Ставят перфект вместе с меткой прошлого: ~~I have seen him yesterday~~ → `I saw him yesterday`.',
    '2. Переносят русское «я живу здесь два года» в present simple:',
    '   `I have lived here for two years` (или `I\'ve been living` — то же, чуть теплее).',
    '3. Забывают, что в AmE `just`, `already`, `yet` спокойно живут и с past simple:',
    '   `Did you eat yet?` — нормальная американская речь, в британском учебнике это ошибка.',
    '',
    '## Метки',
    '',
    '- перфект: `ever`, `never`, `so far`, `since 2020`, `for three weeks`, `already`, `just`',
    '- past simple: `ago`, `yesterday`, `last night`, `when I was a kid`, `in March`',
  ].join('\n'),
  scenes: [
    {
      type: 'case',
      caseTitle: 'Дело №7: Пропавший коммит',
      intro_ru:
        'Ночь на 14 марта, офис на West Loop. Из репозитория выпилен коммит с ключами от прода. ' +
        'Детектив Мия Торрес допрашивает троих, у кого был доступ.',
      steps: [
        {
          narrative:
            'Первым заходит Брэд из платформенной команды, в руках холодный кофе.\n\n' +
            '**"I have pushed that fix yesterday around eleven, then I went home."**\n\n' +
            'Мия ставит галочку в блокноте и ничего не говорит.',
          question_ru: 'Что зацепило Мию в первой фразе?',
          choices: [
            'Перфект с меткой прошлого — фразу он готовил заранее, а не вспоминал',
            'Он сказал "then I went home" — нельзя два прошедших подряд',
            'Ничего, фраза нормальная',
          ],
          answer: 0,
          clue_ru:
            '`yesterday around eleven` — закончившийся отрезок, значит `I pushed`. Живой носитель ' +
            'так не оговорится: заученная формулировка выдаёт заготовленное алиби.',
        },
        {
          narrative:
            'Вторая — Прия, тимлид, приехала из Остина утром.\n\n' +
            '**"I haven\'t touched that repo since February. I saw the alert at 3 a.m. and called Jake."**\n\n' +
            'Мия сверяется с логами: последний её пуш — 9 февраля.',
          question_ru: 'Её грамматика подтверждает или ломает алиби?',
          choices: [
            'Ломает: с `since` нужен past simple',
            'Подтверждает: `since February` — отрезок, который тянется до сейчас, перфект на месте',
            'Ломает: `I saw the alert` должно быть `I have seen`',
          ],
          answer: 1,
          clue_ru:
            '`since February` тянет линию в настоящее → present perfect. А `at 3 a.m.` — точка в ' +
            'прошлом → past simple. Прия переключается правильно и на автомате: не заучено.',
        },
        {
          narrative:
            'Третий — стажёр Коул. Смотрит в пол.\n\n' +
            '**"I\'ve deleted it. Like, twenty minutes ago. I\'ve panicked."**\n\n' +
            'Мия впервые за ночь садится.',
          question_ru: 'Первая фраза Коула — какая?',
          choices: [
            'Обе неправильные',
            '`I\'ve deleted it` — норм (результат налицо), `I\'ve panicked` с `twenty minutes ago` — мимо',
            'Обе правильные, он просто волнуется',
          ],
          answer: 1,
          clue_ru:
            'Коммита нет прямо сейчас — `I\'ve deleted it` идеально. Но `twenty minutes ago` ' +
            'приколачивает событие к прошлому: `I panicked`. Он не врал — он просто плохо спал.',
        },
      ],
      outro_ru:
        'Коул снёс коммит спросонья, приняв его за свой тестовый. Ключи ротировали к семи утра. ' +
        'Брэда Мия всё-таки взяла на карандаш: заготовленное алиби на пустом месте не рождается.',
    },
    {
      type: 'thread',
      contact: { name: 'Jake', emoji: '👨‍💻', desc_ru: 'твой техлид, Остин' },
      intro_ru: 'Четверг, 16:40. Джейк собирает статус перед релизом.',
      steps: [
        {
          incoming: ['hey — status on the auth refactor?', 'need it for standup in 20'],
          options: [
            {
              text: "I've pushed the first half, still fighting the token refresh",
              verdict: 'natural',
              note_ru: 'Результат уже в репо + работа продолжается — ровно перфект. Так и пишут.',
            },
            {
              text: 'I have pushed the first half yesterday, still fighting the token refresh',
              verdict: 'error',
              note_ru: '`yesterday` не живёт с перфектом. Либо `I pushed ... yesterday`, либо убрать метку.',
            },
            {
              text: 'I have completed fifty percent of the task and I am continuing my work',
              verdict: 'textbook',
              note_ru: 'Грамматически чисто и абсолютно нечеловечно. В Slack так не пишут.',
            },
          ],
        },
        {
          incoming: ['cool. did QA look at it yet?'],
          options: [
            {
              text: "nope, I haven't handed it off yet — probably tomorrow morning",
              verdict: 'natural',
              note_ru: '`haven\'t ... yet` — отрезок ещё открыт. `nope` в рабочем чате нормально.',
            },
            {
              text: 'no, I did not hand it off yet, probably tomorrow morning',
              verdict: 'textbook',
              note_ru: 'В AmE такое слышно живьём, но в письме читается как обрубок. Перфект тут ровнее.',
            },
            {
              text: "no, I don't handed it off yet",
              verdict: 'error',
              note_ru: '`don\'t` + третья форма — каша. Нужен `haven\'t handed`.',
            },
          ],
        },
      ],
      outro_ru: 'Джейк передвинул QA на пятницу и попросил не героизировать до ночи.',
    },
    {
      type: 'dub',
      show_ru: '«Halsted Street», s02e05 — Дэнни занял у тебя дрель и пропал на неделю',
      steps: [
        {
          scene_ru: 'Лестничная клетка, ты сталкиваешься с Дэнни, у него в руках пакет из прачечной.',
          line_ru: 'Слушай, ты дрель так и не вернул.',
          reference: "Hey, you still haven't brought my drill back.",
          alt: "Hey, you never gave me my drill back.",
          note_ru:
            '«Так и не» = отрезок открыт, дрели до сих пор нет → `still haven\'t`. Порядок именно ' +
            '`still haven\'t`, не `haven\'t still`. Вариант с `never` — то же самое, но с упрёком.',
        },
        {
          scene_ru: 'Дэнни делает виноватое лицо и роется в памяти.',
          line_ru: 'Я вернул её в субботу. Оставил под дверью.',
          reference: 'I brought it back on Saturday. I left it by your door.',
          alt: null,
          note_ru:
            '`on Saturday` — закрытая точка в прошлом, перфект запрещён. Русское «вернул» тут ' +
            'именно past simple, хотя результат вроде бы «сейчас».',
        },
      ],
    },
    {
      type: 'radar',
      intro_ru: '7 секунд на карточку. Звучит по-американски — ✓, режет ухо — ✗.',
      cards: [
        {
          phrase: "I've seen her yesterday at the coffee shop.",
          ok: false,
          fix: 'I saw her yesterday at the coffee shop.',
          flash_ru: 'yesterday — метка прошлого, перфект запрещён',
        },
        {
          phrase: "I've known Rachel since she sold me the place.",
          ok: true,
          flash_ru: 'since + перфект: знакомство тянется до сих пор',
        },
        {
          phrase: 'Have you had your lunch already?',
          ok: false,
          fix: 'Did you eat yet?',
          flash_ru: 'британское. В США чаще past simple и без "your"',
        },
        {
          phrase: "We haven't decided on the venue yet.",
          ok: true,
          flash_ru: 'yet + перфект, отрезок открыт — чисто',
        },
        {
          phrase: 'I live in Chicago for three years.',
          ok: false,
          fix: "I've lived in Chicago for three years.",
          flash_ru: 'калька с русского «я живу три года»: нужен перфект',
        },
        {
          phrase: 'Sam just texted me about the closing shift.',
          ok: true,
          flash_ru: 'в AmE just спокойно живёт с past simple',
        },
      ],
    },
    {
      type: 'letter',
      from_ru:
        'Рэйчел, риелтор, пишет клиенту про квартиру на Ashland. Восемь ошибок, все — про время. ' +
        'Тыкай в подозрительные куски, потом жми «Готово».',
      segments: [
        { text: 'Hi Marco,\n\n' },
        { text: 'I ' },
        { text: 'have talked', error: true, fix: 'talked', note_ru: 'ниже — `on Tuesday`, закрытая точка' },
        { text: ' to the owner on Tuesday and he ' },
        { text: 'has agreed', error: true, fix: 'agreed', note_ru: 'то же событие того же вторника' },
        { text: ' to hold the unit. ' },
        { text: 'Since then I ' },
        { text: "haven't heard", note_ru: '' },
        { text: ' anything from him, which is normal for March.\n\n' },
        { text: 'I ' },
        { text: 'am living', error: true, fix: "have lived", note_ru: 'отрезок от прошлого до сейчас → перфект' },
        { text: ' in this neighborhood for eleven years, so trust me on the noise. ' },
        { text: 'The building ' },
        { text: 'was renovated', note_ru: '' },
        { text: ' in 2021 and nothing ' },
        { text: 'went wrong', error: true, fix: 'has gone wrong', note_ru: 'с 2021 и до сих пор — отрезок открыт' },
        { text: ' since.\n\n' },
        { text: 'Did you already sent', error: true, fix: 'Did you already send', note_ru: 'после did — инфинитив' },
        { text: ' the deposit? I ' },
        { text: 'have checked', error: true, fix: 'checked', note_ru: '`this morning at 9` — точка в прошлом' },
        { text: ' the account this morning at 9 and it ' },
        { text: 'was empty', note_ru: '' },
        { text: '. If you ' },
        { text: 'have sent it yesterday', error: true, fix: 'sent it yesterday', note_ru: 'опять yesterday + перфект' },
        { text: ', it should land by tonight.\n\n' },
        { text: 'I ' },
        { text: 'never worked', error: true, fix: "have never worked", note_ru: '`never` про опыт до сих пор → перфект' },
        { text: ' with a lender this slow, honestly.\n\n' },
        { text: 'Rachel' },
      ],
      corrected:
        'Hi Marco,\n\n' +
        'I talked to the owner on Tuesday and he agreed to hold the unit. Since then I ' +
        "haven't heard anything from him, which is normal for March.\n\n" +
        'I have lived in this neighborhood for eleven years, so trust me on the noise. ' +
        'The building was renovated in 2021 and nothing has gone wrong since.\n\n' +
        'Did you already send the deposit? I checked the account this morning at 9 and it was ' +
        'empty. If you sent it yesterday, it should land by tonight.\n\n' +
        "I have never worked with a lender this slow, honestly.\n\nRachel",
    },
  ],
};

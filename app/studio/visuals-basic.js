// Original teaching diagrams: each comparison uses forms taught in its lesson.
// English text remains plain so it can also be read aloud without UI markup.
export const basicVisuals = {
 'path-be': {
  title:'Одна мысль — три формы связки',kind:'contrast',
  why:'Выбираем am, is или are по тому, о ком говорим. Ready остаётся тем же словом.',
  items:[
   {label:'Я → am',en:'I am ready.',ru:'Я готов.',note:'I дружит с am.'},
   {label:'Она → is',en:'She is ready.',ru:'Она готова.',note:'He, she, it дружат с is.'},
   {label:'Ты / мы / они → are',en:'You are ready.',ru:'Ты готов. / Вы готовы.',note:'You, we, they дружат с are.'}
  ],footnote:'В русском «Я готов» связки нет. В английской фразе am пропускать нельзя.'
 },
 'path-pronouns': {
  title:'Один человек, три роли',kind:'contrast',
  why:'Выбор I, me или my зависит от работы слова в предложении.',
  items:[
   {label:'Кто знает?',en:'I know Alex.',ru:'Я знаю Алекса.',note:'I здесь называет того, кто знает.'},
   {label:'Кого знают?',en:'Alex knows me.',ru:'Алекс знает меня.',note:'Me здесь называет того, кого знают.'},
   {label:'Чья вещь?',en:'It is my book.',ru:'Это моя книга.',note:'My ставим перед названием вещи.'}
  ]
 },
 'path-present-simple': {
  title:'Утверждаю → отрицаю → спрашиваю',kind:'sequence',
  why:'Для обычного действия вопрос и отрицание собираются с do или does.',
  items:[
   {label:'Обычная работа',en:'She works here.',ru:'Она работает здесь.',note:'В утверждении у works появляется -s.'},
   {label:'Это не так',en:"She doesn't work here.",ru:'Она здесь не работает.',note:'Doesn’t уже несёт нужную форму; work без -s.'},
   {label:'Хочу узнать',en:'Does she work here?',ru:'Она здесь работает?',note:'Does перед she; work снова без -s.'}
  ],footnote:'С I, you, we, they используем do / don’t. Am перед work не добавляем.'
 },
 'path-present-continuous': {
  title:'Обычно или в процессе сейчас?',kind:'contrast',
  why:'Один глагол work может описывать привычку или занятие в текущий момент.',
  items:[
   {label:'Обычно',en:'I work here.',ru:'Я работаю здесь.',note:'Сообщаю о своей обычной работе.'},
   {label:'Сейчас',en:'I am working.',ru:'Я сейчас работаю.',note:'Am + working: действие в процессе.'},
   {label:'Вопрос о сейчас',en:'Are you working?',ru:'Ты сейчас работаешь?',note:'Переносим are вперёд. Do не нужен.'}
  ]
 },
 'path-questions-basic': {
  title:'Сначала выбери, о чём спрашиваешь',kind:'contrast',
  why:'Where значит «где», но порядок следующих слов зависит от типа предложения.',
  items:[
   {label:'Где человек?',en:'Where are you?',ru:'Где ты?',note:'У нас уже есть are. Ставим его перед you.'},
   {label:'Где действие?',en:'Where do you work?',ru:'Где ты работаешь?',note:'Для work нужен помощник do.'},
   {label:'Где её действие?',en:'Where does she work?',ru:'Где она работает?',note:'С she нужен does, а work остаётся без -s.'}
  ]
 },
 'path-articles-basic': {
  title:'Назвать вещь или указать на известную',kind:'contrast',
  why:'A/an называют одну вещь такого типа. The помогает узнать, какую именно вещь мы имеем в виду.',
  items:[
   {label:'Одна книга',en:'It is a book.',ru:'Это книга.',note:'Пока просто называем предмет.'},
   {label:'Одна вещь, гласный звук',en:'It is an apple.',ru:'Это яблоко.',note:'Apple начинается с гласного звука, поэтому используем an.'},
   {label:'Уже известная книга',en:'The book is red.',ru:'Книга красная.',note:'Теперь описываем ту книгу, о которой уже говорили.'}
  ],footnote:'A и an отличаются звучанием, а не значением. Здесь red — «красный».'
 },
 'path-plurals': {
  title:'Больше одного: что меняется в слове',kind:'contrast',
  why:'Число стоит перед предметом, а окончание помогает показать, что предметов несколько.',
  items:[
   {label:'Обычное -s',en:'one book → two books',ru:'одна книга → две книги',note:'Добавили -s.'},
   {label:'После x: -es',en:'one box → two boxes',ru:'одна коробка → две коробки',note:'Добавили -es, чтобы окончание можно было произнести.'},
   {label:'Согласная + y',en:'one baby → two babies',ru:'один малыш → два малыша',note:'Y заменили на ies.'},
   {label:'Гласная + y',en:'one toy → two toys',ru:'одна игрушка → две игрушки',note:'Y оставили, добавили -s.'}
  ],footnote:'Перед two books не ставим a: a относится к одному предмету.'
 },
 'path-there-is': {
  title:'Сначала сообщаем, что есть',kind:'contrast',
  why:'There is / there are вводят предметы в разговор. Затем можно уточнить место.',
  items:[
   {label:'Один предмет',en:'There is a book in the room.',ru:'В комнате есть книга.',note:'Одна книга → is.'},
   {label:'Несколько предметов',en:'There are two books in the room.',ru:'В комнате есть две книги.',note:'Две книги → are.'},
   {label:'Проверяем наличие',en:'Is there a chair?',ru:'Есть стул?',note:'Для вопроса is и there меняются местами.'}
  ],footnote:'В этой конструкции there не нужно переводить отдельным словом «там».'
 },
 'path-countability': {
  title:'Штуки или количество вещества?',kind:'contrast',
  why:'Книги считаем по одной. Воду без единицы измерения называем как вещество.',
  items:[
   {label:'Отдельные предметы',en:'How many books?',ru:'Сколько книг?',note:'Можно ответить two books. Поэтому many.'},
   {label:'Вещество',en:'How much water?',ru:'Сколько воды?',note:'Не two waters в этом значении. Поэтому much.'},
   {label:'Есть некоторое количество',en:'I have some water.',ru:'У меня есть немного воды.',note:'Some — некоторое количество.'},
   {label:'Спрашиваем о наличии',en:'Do you have any water?',ru:'У тебя есть вода?',note:'В таком вопросе обычно any.'}
  ]
 },
 'path-possession': {
  title:'Have / has: утверждение, отрицание и вопрос',kind:'sequence',
  why:'После does / doesn’t возвращаем обычную форму have.',
  items:[
   {label:'Я',en:'I have a phone.',ru:'У меня есть телефон.',note:'Have — «у меня есть».'},
   {label:'Она',en:'She has a phone.',ru:'У неё есть телефон.',note:'She + has.'},
   {label:'У неё нет',en:"She doesn't have a phone.",ru:'У неё нет телефона.',note:'Doesn’t + have, не has.'},
   {label:'У неё есть?',en:'Does she have a phone?',ru:'У неё есть телефон?',note:'Does + she + have.'}
  ]
 },
 'path-place-time': {
  title:'Внутри, на поверхности, у точки',kind:'contrast',
  why:'In, on и at по-разному показывают связь предмета с местом.',
  items:[
   {label:'Внутри → in',en:'The book is in the bag.',ru:'Книга в сумке.',note:'Сумка окружает книгу.'},
   {label:'На поверхности → on',en:'The book is on the desk.',ru:'Книга на столе.',note:'Книга лежит на поверхности стола.'},
   {label:'У места → at',en:'I am at the door.',ru:'Я у двери.',note:'Дверь обозначает точку, у которой я нахожусь.'}
  ],footnote:'Для времени другая памятка: at five — в пять; on Monday — в понедельник; in May — в мае.'
 },
 'path-requests-can': {
  title:'Can остаётся тем же',kind:'contrast',
  why:'После can используем обычный глагол: без to и без -s.',
  items:[
   {label:'Умею',en:'I can swim.',ru:'Я умею плавать.',note:'Can + swim.'},
   {label:'Не умею',en:"I can't swim.",ru:'Я не умею плавать.',note:'Can’t значит cannot.'},
   {label:'Можешь помочь?',en:'Can you help me?',ru:'Можешь мне помочь?',note:'Can перед you превращает мысль в вопрос.'},
   {label:'Она тоже умеет',en:'She can swim.',ru:'Она умеет плавать.',note:'Ни cans, ни swims здесь не нужны.'}
  ]
 },
 'path-instructions': {
  title:'Действие сразу в начале',kind:'sequence',
  why:'Когда просим человека что-то сделать, обычно не произносим you.',
  items:[
   {label:'Просьба',en:'Open the door.',ru:'Открой дверь.',note:'Начинаем с open — «открой».'},
   {label:'Вежливая просьба',en:'Please open the door.',ru:'Пожалуйста, открой дверь.',note:'Please добавляет вежливость.'},
   {label:'Просьба не делать',en:"Please don't close the door.",ru:'Пожалуйста, не закрывай дверь.',note:'Don’t перед close означает «не закрывай».'}
  ]
 },
 'path-adjectives-frequency': {
  title:'Место слова зависит от его работы',kind:'contrast',
  why:'Описание ставим перед предметом или после be. Always, usually и never обычно стоят перед действием, но после be.',
  items:[
   {label:'Описание перед вещью',en:'It is a small bag.',ru:'Это маленькая сумка.',note:'Small перед bag; a относится ко всей группе a small bag.'},
   {label:'Описание после is',en:'The bag is small.',ru:'Сумка маленькая.',note:'Small после is; a перед small не нужен.'},
   {label:'Частота перед действием',en:'I usually read.',ru:'Я обычно читаю.',note:'Usually перед read.'},
   {label:'Частота после be',en:'I am always ready.',ru:'Я всегда готов.',note:'Always после am.'}
  ]
 },
 'path-sound-basics': {
  title:'Те же слова, разный смысловой акцент',kind:'contrast',
  why:'Заглавные буквы здесь показывают голосовое выделение, а не обычное написание.',
  items:[
   {label:'Выделяем готовность',en:'I am READY.',ru:'Я ГОТОВ.',note:'Подчёркиваем: уже можно начинать.'},
   {label:'Выделяем человека',en:'I am ready.',ru:'Я готов.',note:'Выдели голосом I: именно я готов; о других не утверждаю.'},
   {label:'Не теряем отрицание',en:'I am NOT ready.',ru:'Я НЕ готов.',note:'Чёткое not полностью меняет сообщение.'}
  ],footnote:'Озвучивание может расставлять ударения иначе. Послушай фразу, затем сам попробуй выделить указанное слово.'
 },
 'path-past-simple': {
  title:'В вопросе и отрицании прошлое показывает did',kind:'sequence',
  why:'В утверждении work становится worked. С did / didn’t основная форма снова work.',
  items:[
   {label:'Событие вчера',en:'I worked yesterday.',ru:'Я работал вчера.',note:'Worked показывает прошлое.'},
   {label:'Этого не было',en:"I didn't work yesterday.",ru:'Я не работал вчера.',note:'Прошлое уже выражено в didn’t.'},
   {label:'Было ли это?',en:'Did you work yesterday?',ru:'Ты работал вчера?',note:'Прошлое уже выражено в did.'}
  ],footnote:'Не все глаголы получают -ed: go → went. Но в вопросе всё равно Did you go?'
 },
 'path-past-continuous': {
  title:'Длинный процесс и событие внутри него',kind:'sequence',
  why:'Was reading даёт фон: чтение уже шло. Called отмечает звонок внутри этого процесса.',
  items:[
   {label:'Процесс в пять',en:'I was reading at five.',ru:'В пять я читал.',note:'Смотрим на занятие в тот момент, не на его начало или конец.'},
   {label:'Звонок в тот же момент',en:'You called at five.',ru:'Ты позвонил в пять.',note:'Звонок произошёл, когда чтение уже шло.'},
   {label:'Соединяем',en:'I was reading when you called.',ru:'Я читал, когда ты позвонил.',note:'When — «когда». Процесс уже шёл в момент звонка.'}
  ],footnote:'Фраза не говорит, что после звонка чтение обязательно закончилось.'
 },
 'path-future-simple': {
  title:'Will: что говорящий делает этой фразой?',kind:'contrast',
  why:'Will может выражать решение или предположение. Оно не превращает прогноз в факт.',
  items:[
   {label:'Решаю сейчас',en:"I'll help you.",ru:'Я тебе помогу.',note:'Реакция на просьбу. I’ll = I will.'},
   {label:'Предполагаю',en:'I think it will rain.',ru:'Думаю, будет дождь.',note:'I think показывает: это моё мнение.'},
   {label:'Говорю «не буду»',en:"I won't work tomorrow.",ru:'Я не буду работать завтра.',note:'Won’t = will not. После него work без изменений.'}
  ]
 },
 'path-future-plans': {
  title:'Намерение и уже устроенная встреча',kind:'contrast',
  why:'Важен не перевод «буду», а то, насколько конкретно подготовлено событие.',
  items:[
   {label:'Есть намерение',en:'I am going to read tonight.',ru:'Я собираюсь читать сегодня вечером.',note:'План решил заранее. Going to + read.'},
   {label:'Есть договорённость',en:'I am meeting Mia tomorrow.',ru:'Завтра я встречаюсь с Мией.',note:'Встреча уже согласована. Tomorrow указывает на будущее.'},
   {label:'Решение в ответ',en:"I'll help you.",ru:'Я тебе помогу.',note:'Решил сейчас — знакомое will из прошлого урока.'}
  ],footnote:'У форм бывают пересечения. Это различие в акценте, а не запрет на любое другое выражение плана.'
 },
 'path-present-perfect': {
  title:'Когда это было — или что важно сейчас?',kind:'contrast',
  why:'Past simple помещает событие в завершённое прошлое. Present perfect связывает его с настоящим.',
  items:[
   {label:'Названо прошлое время',en:'I finished yesterday.',ru:'Я закончил вчера.',note:'Yesterday отвечает на вопрос «когда».'},
   {label:'Важен результат сейчас',en:'I have finished.',ru:'Я закончил.',note:'Работа готова сейчас. Have + finished.'},
   {label:'Опыт до настоящего',en:'Have you ever been there?',ru:'Ты когда-нибудь там бывал?',note:'Не спрашиваем дату. Been — третья форма be.'}
  ],footnote:'В американской разговорной речи past simple тоже часто используют для недавних событий. Здесь сравниваем назначение конструкций.'
 },
 'path-comparatives': {
  title:'Маленький → меньше → самый маленький',kind:'scale',
  why:'Сначала описываем размер, затем сравниваем два предмета, затем выделяем один из группы.',
  items:[
   {label:'Просто описание',en:'This bag is small.',ru:'Эта сумка маленькая.',note:'Small — свойство самой сумки.'},
   {label:'Сравнение с другой',en:'This bag is smaller than that bag.',ru:'Эта сумка меньше той.',note:'Smaller + than показывает, с чем сравниваем.'},
   {label:'Среди всех сумок',en:'This is the smallest bag.',ru:'Это самая маленькая сумка.',note:'The smallest выделяет одну из рассматриваемой группы.'}
  ],footnote:'Размер может не подходить: too small — слишком маленькая; small enough — достаточно маленькая для нашей цели.'
 },
 'path-past-habits': {
  title:'Один случай или прежняя жизнь?',kind:'contrast',
  why:'Used to показывает, что раньше было обычно, а теперь изменилось.',
  items:[
   {label:'Один звонок',en:'I called yesterday.',ru:'Я позвонил вчера.',note:'Обычный past simple сообщает об одном событии.'},
   {label:'Прежняя привычка',en:'I used to call every day.',ru:'Раньше я звонил каждый день.',note:'Повторялось в прошлом; теперь так не делаю.'},
   {label:'Прежнее состояние',en:'I used to live here.',ru:'Раньше я жил здесь.',note:'Теперь живу в другом месте. После to — live, не lived.'}
  ]
 },
 'path-obligation': {
  title:'Нужно, стоит, запрещено, необязательно',kind:'contrast',
  why:'Отрицание может означать отсутствие обязанности или запрет. Это разные сообщения.',
  items:[
   {label:'Обязанность',en:'You have to go.',ru:'Тебе нужно идти.',note:'Есть необходимость.'},
   {label:'Совет',en:'You should go.',ru:'Тебе стоит пойти.',note:'Рекомендация, а не обязательное правило.'},
   {label:'Нет обязанности',en:"You don't have to go.",ru:'Тебе необязательно идти.',note:'Можно пойти, можно остаться.'},
   {label:'Запрет',en:"You mustn't go.",ru:'Тебе нельзя идти.',note:'Идти запрещено. Это не то же, что don’t have to.'}
  ]
 },
 'path-zero-first': {
  title:'Условие → результат',kind:'contrast',
  why:'Одна схема объясняет привычный результат, другая — возможное будущее.',
  items:[
   {label:'Так обычно бывает',en:'If I am tired, I rest.',ru:'Если я устаю, я отдыхаю.',note:'Present + present: привычная связь.'},
   {label:'Так может произойти',en:'If I am free, I will call.',ru:'Если я буду свободен, я позвоню.',note:'После if — am; будущее will стоит в результате.'}
  ],footnote:'В русском после «если» звучит «буду», но здесь не нужно переносить will в if-часть.'
 },
 'path-gerund-infinitive': {
  title:'Первый глагол выбирает форму второго',kind:'contrast',
  why:'Read остаётся тем же действием, но после разных слов оформляется по-разному.',
  items:[
   {label:'Want → to + действие',en:'I want to read.',ru:'Я хочу читать.',note:'После want соединяем глаголы через to.'},
   {label:'Enjoy → действие с -ing',en:'I enjoy reading.',ru:'Мне нравится читать.',note:'После enjoy нужна форма reading.'},
   {label:'Am + -ing — другой смысл',en:'I am reading.',ru:'Я сейчас читаю.',note:'Знакомый процесс сейчас. У enjoy reading такого значения нет.'}
  ],footnote:'Не любое -ing означает «прямо сейчас». Смотри на всю конструкцию.'
 },
 'path-relative-basic': {
  title:'Уточнение прикрепляется к нужному слову',kind:'contrast',
  why:'Who / that добавляют признак, по которому собеседник узнаёт человека или вещь.',
  items:[
   {label:'Какой человек?',en:'The person who works here is Mia.',ru:'Человек, который здесь работает, — Мия.',note:'Who works here относится к person.'},
   {label:'Какая книга?',en:'The book that is on the desk is red.',ru:'Книга, которая лежит на столе, красная.',note:'That is on the desk относится к book. Red — «красная».'}
  ],footnote:'В этих примерах уточнение помогает выбрать нужного человека или предмет, поэтому английские запятые не ставим.'
 },
 'path-connectors-basic': {
  title:'Связка показывает, как соединены мысли',kind:'contrast',
  why:'Связка объясняет, как одна мысль относится к другой: причина, результат или контраст.',
  items:[
   {label:'Сообщение ← причина',en:'I am resting because I am tired.',ru:'Я отдыхаю, потому что устал.',note:'После because объясняем почему.'},
   {label:'Причина → результат',en:'I am tired, so I am resting.',ru:'Я устал, поэтому отдыхаю.',note:'После so называем следствие.'},
   {label:'Ожидали другое',en:'I am tired, but I am working.',ru:'Я устал, но работаю.',note:'But противопоставляет работу ожидаемому отдыху.'},
   {label:'Уступка',en:'Although I am tired, I am working.',ru:'Хотя я устал, я работаю.',note:'Although вводит обстоятельство, которое не помешало.'}
  ]
 },
 'path-everyday-phrasal': {
  title:'Название можно двигать, it — только в середину',kind:'sequence',
  why:'У turn off название выключаемой вещи может стоять в двух местах.',
  items:[
   {label:'Название в конце',en:'Turn off the light.',ru:'Выключи свет.',note:'Turn off + the light.'},
   {label:'Название в середине',en:'Turn the light off.',ru:'Выключи свет.',note:'Обе формы правильные.'},
   {label:'Заменяем на it',en:'Turn it off.',ru:'Выключи его.',note:'It обязательно между turn и off.'}
  ],footnote:'Это свойство turn off, а не всех сочетаний: look for my phone — «искать мой телефон»; for не отрываем.'
 },
 'path-listening-routine': {
  title:'Поправка заменяет первую деталь',kind:'sequence',
  why:'Человек может исправиться. Запоминаем итоговое сообщение, а не первое знакомое число.',
  items:[
   {label:'Сначала услышали',en:'The meeting is at five.',ru:'Встреча в пять.',note:'Пока известное время — пять.'},
   {label:'Затем поправка',en:'Sorry, at seven.',ru:'Извини, в семь.',note:'Sorry показывает исправление.'},
   {label:'Итог',en:'The meeting is at seven.',ru:'Встреча в семь.',note:'Именно это время нужно сохранить.'}
  ],footnote:'Сначала прослушай пример без чтения. После ответа открой текст и проверь, где прозвучала поправка.'
 },
 'path-email-basic': {
  title:'Короткое сообщение собирается из четырёх деталей',kind:'sequence',
  why:'Каждая фраза помогает адресату понять просьбу и ответить на неё.',
  items:[
   {label:'К кому обращаюсь',en:'Hi, Mia.',ru:'Привет, Мия.',note:'Называю адресата.'},
   {label:'Что мне нужно',en:'Can you help me?',ru:'Можешь мне помочь?',note:'Сразу сообщаю цель.'},
   {label:'Нужная деталь',en:'I am free at five.',ru:'Я свободен в пять.',note:'Даю время, о котором можно договориться.'},
   {label:'Спокойно заканчиваю',en:'Thanks!',ru:'Спасибо!',note:'Короткой благодарности достаточно.'}
  ]
 }
};

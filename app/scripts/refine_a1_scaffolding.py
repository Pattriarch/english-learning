"""Reviewed A1 output scaffolding; preserves sources and all stable lesson IDs.

The former prompts sometimes asked beginners to write English metalinguistic
analysis. This migration keeps the reasoning in Russian and requires short,
purposeful English utterances. Immutable local backup precedes publication.
"""
from copy import deepcopy
import json
from pathlib import Path
from build_book_lessons import atomic_json
from build_extended_course import APP, digest, validate
from finalize_extended_course import finalize

MIGRATION='2026-09-10-a1-purposeful-short-output'
# Exact task replacements were read against all four lessons' complete inputs.
EDITS={
'extended-a1-notices':{
'e1':('Прочитай m1. Напиши посетителю четыре короткие английские фразы: каким входом пользоваться, куда подойти сначала, куда убрать большую сумку и можно ли взять маленькую сумку в класс. Достаточно 20–35 слов. Не нужно объяснять назначение объявления на английском.',
'Please use the main entrance. Go to reception first. Leave large bags in the bag room. You can take a small bag into class.',
'Здесь нужны четыре практических действия. Side door предназначена сотрудникам; new visitors сначала подходят к reception. Различие large/small существенно: запрет относится только к большой сумке. Императив с please подходит для короткой инструкции посетителю; you can передаёт разрешение. Не требуются ни пересказ всех объявлений, ни рассуждение об их функции. Если ты написал Small bags are OK in class, смысл тоже сохранён. Проверяй адресата, действие и ограничение, а не совпадение слов с примером.'),
'e2':('Прочитай m1 и m2. Напиши коллеге четыре коротких предложения по-английски: где комната для сумок, где Room 2, когда обычно начинается английский и когда он начинается в среду. Достаточно 25–40 слов. Затем по-русски назови слова объявления, которые показывают исключение; английский анализ и три цитаты не нужны.',
'The bag room is opposite reception. Room 2 is next to the café. English usually starts at ten. On Wednesday, it starts at eleven.\n\nИсключение ограничивают слова «On Wednesday only».',
'Сначала нужны два разных пространственных отношения: opposite означает напротив, next to — рядом. Затем сохраняются обычное время и исключение, действующее в среду. Не заменяй usually словом always: тогда следующее предложение окажется противоречием. Для начального уровня достаточно четырёх отдельных предложений; сложные придаточные здесь не являются целью. Русская заметка помогает проверить логику only без требования владеть английскими терминами condition или exception. Источник даёт все четыре факта; новые этажи или дни придумывать не нужно.'),
'e3':('Открой m3. Посетитель пришёл в среду с большой сумкой и просит записку. Напиши ему три коротких английских предложения: где оставить сумку, куда идти на английский и во сколько начало. Достаточно 20–35 слов. По-русски объясни, почему здесь нужна записка. Не пиши английский анализ ситуации.',
'Leave your large bag in the bag room. Go to Room 2, next to the café. Today, English starts at eleven.\n\nПосетитель плохо слышит и просит записать информацию.',
'Из нового сообщения важны Wednesday, large bag и Please write it down. Первые два факта определяют содержание ответа; третий определяет его форму. В записке нельзя поставить обычные десять часов или разрешить большую сумку в классе. Предложения могут быть короткими: это полезная адаптация к адресату, а не неполноценный ответ. По-русски объясни выбор письменной формы. Посетитель не просил объяснять грамматику или пересказывать весь план центра; три точных действия решают его текущую задачу.'),
'e4':('Сравни выражения next to и opposite в m2. Придумай другое место — например, улицу рядом с домом — и напиши два своих английских предложения: что находится рядом с чем и что напротив чего. Достаточно 12–25 слов. По-русски объясни различие. Это вымышленное место, а не новые сведения о центре.',
'The coffee shop is next to my apartment building. The bus stop is opposite the park.\n\nNext to — рядом, opposite — напротив.',
'Здесь ты переносишь пространственные отношения в собственный пример. Оба предложения должны называть два понятных объекта и показывать, как они расположены. Нельзя считать next to и opposite взаимозаменяемыми: соседний магазин и магазин через улицу требуют разных указаний. Можешь описать реальную улицу или придумать её, но не добавляй эти сведения к плану Oak Centre. Русское объяснение показывает понимание различия; английская часть тренирует готовое предложение, которое затем можно использовать, когда объясняешь дорогу.'),
'e8':('Новый случай: в четверг приходит посетитель с маленькой сумкой. Прочитай m1–m2, затем закрой предыдущие ответы. Исправь всю записку: “Please stop at reception. You cannot take your small bag into class. On Thursday, English starts at eleven. Go to Room 2 next to the café.” Напиши короткую правильную записку, 25–40 английских слов. Две причины исправления объясни по-русски.',
'Please stop at reception. You can take your small bag into class. On Thursday, English starts at ten. Go to Room 2 next to the café.\n\nМаленькие сумки разрешены. Начало в одиннадцать относится только к среде.',
'В новом случае изменились день и размер сумки, поэтому нельзя механически повторять записку для предыдущего посетителя. Четверг следует обычному расписанию: десять часов. Маленькую сумку разрешено брать в класс. При этом reception и Room 2 остаются верными ориентирами, их нужно сохранить. Объяснения причин допускаются по-русски, потому что проверяется понимание объявления, а не умение писать английский лингвистический комментарий. Эта новая ситуация — первый перенос; настоящий поздний повтор выполняй в разделе закрепления после временного интервала.')},
'extended-a1-registration':{
'e3':('Открой m1 и карточку m2. Заполни поля по сообщению, неизвестное оставь пустым. Затем напиши одно короткое английское предложение: какой информации нет. По-русски назови фрагмент с буквами имени, проверь одно число и отметь, что лично тебе было трудно расслышать. Если ошибок не было, так и скажи. Не нужно писать английское объяснение качества регистрации.',
'Name: Kim Reed\nAddress: 14 Hill Street\nEmail:\nPhone: 01632 481 715\nDate: 19 June, if there is a place\n\nThere is no email address in the message.\n\nИмя: «K-I-M, R-E-E-D». Дом fourteen — 14. Свой результат первой попытки проверь отдельно.',
'Карточка отделяет факты от догадок. Пустое поле Email означает только отсутствие сведений в сообщении: из этого нельзя сделать вывод, что у человека вообще нет почты. Дата первого визита сохраняет условие if there is a place. Написание имени проверяй по буквам, а номер дома — по слову fourteen. Одного английского предложения об отсутствующих данных достаточно. Личную трудность опиши по-русски и только если она действительно была; не копируй чужую ошибку ради заполнения учебной заметки.'),
'e8':('После короткой паузы прослушай m3 и исправь всю карточку: “Name: Kim Reed. Address: 14 Hill Street. Phone: 01632 481 715. Date: 12 June. Email: Kim has no email.” Запиши поля правильно; условие о месте возьми из m1. После карточки по-русски объясни исправление адреса и пустое поле Email. Длинный английский отчёт не нужен.',
'Name: Kim Reed\nAddress: 40 Hill Street\nPhone: 01632 481 715\nDate: 19 June, if there is a place\nEmail:\n\nВ m3 Ким исправляет fourteen на forty. Адрес электронной почты не сообщён; это не означает, что его нет.',
'Последующее сообщение исправляет адрес, но не меняет имя, телефон и условие визита. Поэтому нельзя заново заполнить карточку только по памяти первого сообщения. Forty — сорок, fourteen — четырнадцать: различие влияет на реальный адрес доставки. Неизвестное поле остаётся пустым. Утверждение Kim has no email было бы лишним выводом, которого источники не подтверждают. Русское пояснение помогает отделить услышанное от собственной догадки. После заполнения произнеси новый адрес вслух и сравни два числительных с записью.')},
'extended-a1-day':{
'e2':('Ещё раз прослушай m1, не открывая текст. Напиши четыре коротких английских предложения о Лее: когда она встаёт, начинает работу, заканчивает работу и занимается английским. Достаточно 25–40 слов. Используй she и сохрани usually для подъёма. Если вместо звука читаешь текст, обозначь текстовую альтернативу; m2 и m3 пока не открывай.',
'Lea usually gets up at seven. She starts work at nine and finishes at five. She studies English at eight for thirty minutes.',
'В этой попытке отслеживай четыре события, а не каждую деталь длинного сообщения. Обычно встаёт в семь — это usually gets up at seven; usually нельзя без основания заменить на always. При переходе от I к she добавляется окончание в gets, starts, finishes и studies. Восемь часов — начало английского, thirty minutes — продолжительность. Разделять сведения на короткие предложения нормально. Завтрак и ужин остаются в источнике для дополнительных тренировок, но не являются обязательными пунктами этого ответа.'),
'e3':('Теперь открой m1 и m2. По-английски напиши два коротких предложения: когда Лея начинает работу и когда начинает Alex. Затем по-русски проверь один факт своей первой попытки и назови слова, на которых сделаешь ударение при сравнении. Не придумывай личную ошибку, если её не было. m3 пока оставь закрытым.',
'Lea starts work at nine. I start work at ten.\n\nСравни свою первую запись с m1. В сравнении выдели nine и ten: именно время различается.',
'Здесь достаточно противопоставить два часа начала работы. В роли Alex говори I start, а о Лее — Lea starts или she starts. Различие не только в числах, но и в форме глагола. Русская заметка относится к твоему собственному первому ответу: если там всё правильно, назови проверенный факт. Выделение nine и ten помогает слушателю услышать контраст. Это самостоятельное наблюдение над записью; проверка текста приложением не устанавливает качество смыслового ударения по акустике.'),
'e6':('Напиши Лее сообщение от лица Alex по m1–m2: поздоровайся, сравни время окончания работы, сообщи своё свободное время и предложи заниматься английским в восемь. Достаточно 25–40 английских слов и коротких предложений. Перечислять весь день Леи не нужно. m3 пока не открывай.',
'Hi, Lea! You finish work at five. I finish at six. I’m free from eight to nine. Can we practice English together at eight?',
'Сообщение должно помочь договориться о практике, поэтому выбирай относящиеся к встрече факты. You finish обращено к Лее; I finish описывает Alex. From eight to nine задаёт доступный интервал, а вопрос предлагает конкретное начало. Нельзя утверждать, что встреча уже согласована: ответа Леи ещё нет. Подробности завтрака не помогают договориться и не нужны в этой короткой версии. Такая выборочность делает письменную речь полезной: ты выражаешь цель, а не воспроизводишь всё, что удалось запомнить.'),
'e8':('Прочитай m3 и исправь весь короткий итог для организатора: “On Wednesday, Lea is free at eight. Alex is free until nine. They can practice from eight to eight thirty. The place is the English club.” Напиши 25–40 английских слов с возможным временем и честно укажи, что место неизвестно. Причину исправления объясни по-русски.',
'On Wednesday, Lea is free at eight thirty. Alex is free until nine. They can practice from eight thirty to nine. They still need a place.\n\nВ среду Лея работает до восьми и свободна в половине девятого. Клуб как место встречи не подтверждён.',
'Обычный распорядок из m1 имеет исключение: по средам Лея работает до восьми. Она предлагает тридцать минут после половины девятого; Alex свободен до девяти, поэтому интервалы совпадают. Can practice означает возможное решение, а не состоявшуюся договорённость. Место источники не устанавливают. Русское пояснение помогает проследить изменение между сообщениями без длинного английского анализа. Для нового переноса позже опиши свой настоящий доступный интервал и предложи встречу в тетради; не копируй расписание вымышленных участников.')},
'extended-a1-order':{
'e1':('Прочитай m1–m2. Напиши два коротких английских предложения от лица посетителя: что ты хочешь заказать и какое решение о размере ещё нужно принять. Достаточно 12–25 слов. Объяснять намерение официанта английскими терминами не требуется.',
'I want a cheese sandwich and a tea. I need to choose the sizes.',
'Исходная роль задаёт две позиции — сырный сэндвич и чай. Размеры ещё не выбраны, поэтому в первом ответе нельзя выдавать small или large за уже согласованный заказ. I want сообщает желание, а I need to choose показывает оставшееся решение. Формулировка a tea допустима при заказе одной порции напитка; это не отменяет неисчисляемость tea при разговоре о веществе. Коротких предложений достаточно, если собеседнику понятны предметы заказа и то, что ещё предстоит уточнить.'),
'e4':('Открой m3, но пока не m4. Напиши две короткие английские фразы для себя: что сейчас нельзя заказать и что ещё нужно выбрать для чая. Затем сформулируй один английский вопрос о возможной доплате за молоко. Достаточно 20–30 слов. Не отвечай вместо официанта.',
'Large sandwiches are not available today. I need to choose the tea size and decide about milk. Is milk extra?',
'Новое сообщение ограничивает выбор сэндвича: большие закончились сегодня. Размер чая остаётся открытым, как и решение о молоке. Вопрос Is milk extra? уточняет цену добавки; из меню нельзя заранее заключить, что она бесплатна. Этот вопрос можно задать на будущее, даже если текущий заказ без молока. Не нужно рассуждать по-английски о типах коммуникативных намерений. Три короткие фразы сохраняют новое ограничение, оставшийся выбор и действительно неизвестную цену; позднейшую ошибку с кофе пока не обсуждай.')}
}

def persist_corrections(before,lessons):
 cp=APP/'content/extended-course-corrections.json';value=json.loads(cp.read_text(encoding='utf-8-sig'))
 originals={l['id']:l for l in before}
 for l in lessons:
  if l['id'] not in EDITS:continue
  existing=[change['path'] for c in value['corrections'] if c['lessonId']==l['id'] for change in c['changes']]
  row={'lessonId':l['id'],'reason':MIGRATION,'changes':[]}
  for n,e in enumerate(l['exercises']):
   if e['id'] not in EDITS[l['id']]:continue
   for field in ['prompt','answers','explanation','context','hint']:
    path=['exercises',n,field]
    if path in existing:continue
    old=originals[l['id']]['exercises'][n][field]
    if old!=e[field]:row['changes'].append({'path':path,'before':old,'after':e[field]})
  if row['changes']:value['corrections'].append(row)
 atomic_json(cp,value)

def main():
 course=APP/'content/courses/extended-skills.json'; logpath=APP/'content/a1-scaffolding-review.json'
 if logpath.exists():
  report=json.loads(logpath.read_text(encoding='utf-8-sig'))
  if report.get('id')==MIGRATION:
   backup=APP/'data/a1-scaffolding-before/course.json'
   if backup.exists():
    persist_corrections(json.loads(backup.read_text(encoding='utf-8-sig')),json.loads(course.read_text(encoding='utf-8-sig')))
   # The published correction receipts are sufficient in a fresh clone. The
   # private, pre-migration backup is an optional local audit artifact.
   finalize(); print('Already applied; complete release verified.');return
 lessons=json.loads(course.read_text(encoding='utf-8-sig'));before=deepcopy(lessons)
 modules={m['id']:m for m in json.loads((APP/'content/extended-course-plan.json').read_text(encoding='utf-8-sig'))['modules']}
 changes=[]
 for l in lessons:
  for e in l['exercises']:
   replacement=EDITS.get(l['id'],{}).get(e['id'])
   if not replacement:continue
   old=deepcopy(e);e['prompt'],model,e['explanation']=replacement;e['answers']=[model]
   e['context']='Начальный уровень A1. Оцени обязательные пункты текущего задания и понятность коротких английских фраз. Анализ причин допускается по-русски; не требуй английского метаязыка или прежнего расширенного объёма.'
   e['hint']='Сначала найди только нужные адресату факты. Соедини их короткими полными фразами; затем проверь время, отрицание и неизвестные сведения.'
   changes.append({'lessonId':l['id'],'exerciseId':e['id'],'beforeSHA256':digest(old),'afterSHA256':digest(e)})
  if l['id'] in EDITS:l['provenance'].setdefault('editorialCorrections',[]).append(MIGRATION)
  validate(l,modules[l['id']])
 # Old correction receipts on these fields need to recognize the new canonical
 # value; their original before values remain preserved for fresh rebuilds.
 cp=APP/'content/extended-course-corrections.json';corrections=json.loads(cp.read_text(encoding='utf-8-sig'))
 byid={l['id']:l for l in lessons}
 for c in corrections['corrections']:
  if c['lessonId'] not in EDITS:continue
  for change in c['changes']:
   p=change['path'];cur=byid[c['lessonId']]
   for key in p:cur=cur[key]
   if p[0]=='exercises':change['after']=deepcopy(cur)
 backup=APP/'data/a1-scaffolding-before';backup.mkdir(exist_ok=True)
 if not (backup/'course.json').exists():atomic_json(backup/'course.json',before);atomic_json(backup/'corrections.json',json.loads(cp.read_text(encoding='utf-8-sig')))
 atomic_json(course,lessons);atomic_json(cp,corrections)
 persist_corrections(before,lessons)
 result=finalize()
 atomic_json(logpath,{'id':MIGRATION,'review':'Task-by-task editorial revision against complete source materials. Russian reasoning separated from required A1 English output. This is not a review of the entire course.','changedExercises':len(changes),'changes':changes})
 print(json.dumps({'changedExercises':len(changes),'publishedModules':result['moduleCount']}))

if __name__=='__main__':main()

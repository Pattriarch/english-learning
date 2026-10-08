# Brief: rewrite one A1 lesson's Russian explanations so a total beginner understands

Repo (worktree): C:\Users\Патриарх\Desktop\english-learning\.claude\worktrees\mcp-mobin-design-update-4b1bb9
Lessons: app/content/courses/foundation.json (a JSON array; the ARRAY ORDER IS NOT THE COURSE ORDER).
REAL course order (content/learning-path.json, A1): 1 path-be, 2 path-sound-basics, 3 path-articles-basic,
4 path-plurals, 5 path-this-that, 6 path-present-simple, 7 path-pronouns, 8 path-possession,
9 path-questions-basic, 10 path-present-continuous, 11 path-there-is, 12 path-countability.
Everything in earlier lessons is already known — don't re-explain it at length (the owner hates repetition);
a one-line reminder is fine.
Scene illustrations with captions: app/studio/course-guide.js (`scenes` object; `mapped` maps lesson id → scene).
How the lesson renders: app/studio/lesson-intro.js (only the first `introSections` sections are shown
before practice; each later section appears right before the task that needs it — see
app/studio/authored-exercise.js / lesson-guidance.js if you need to check which).

## Who reads this
An adult Russian speaker who knows NO English grammar and no terminology. The product owner read the
old first lesson and was angry because:
- A picture showed "I am ready. I am tired." as one line, and the Russian "Я готова. Я устала." sat
  separately below; nothing said which English goes with which Russian or which half of the picture.
  (Already fixed in code: scenes now have `panels`, one subtitle per panel + "Слева / Справа" pairs.)
- Vague teasers: "Почему здесь появляется am? Разберём ниже." — where? what? Don't tease, say it.
- "Почему появляется ещё одно слово?" — they thought "am" might be an article. Say what a thing IS
  (in plain words: «это глагол "быть"», «это маленькое слово-указатель») and what it is NOT when a
  confusion is likely.
- Abstract phrasing: «связка связывает человека с состоянием и показывает время» — too bookish.
- "Дальше научимся говорить о тебе, о ней и о нас" — unclear; instead name the actual words:
  «"ты" — you are, "она" — she is».
- The rule's limits must be explicit: «am нужен, только когда говоришь, какой ты. С действием
  ("я работаю") его не ставят: I work.»
- The goal line under the title sounded off-topic. It must say in plain words what the learner will
  be able to SAY after the lesson, with 1–2 Russian examples.

## Reference: the approved rewrite of lesson 1 (path-be), section 1
Title: Почему нельзя сказать просто «I ready»
Body (paragraphs separated by \n\n):
Представь: друг ждёт тебя у двери, и ты говоришь: «Я готов». Ты не рассказываешь, что делаешь. Ты сообщаешь, какой ты сейчас.
По-русски между «я» и «готов» ничего нет. По-английски там обязательно стоит слово-связка. Для I («я») это am: I am ready — я готов. I am tired — я устал.
Am — не артикль и не лишнее слово. Это глагол be — «быть». Дословно выходит «я есть готов», но по-русски так не говорят, поэтому переводим просто «Я готов». «Быть» есть и в русском: «Я был готов», «Я буду готов». Только в настоящем времени мы его пропускаем, а английский — никогда.
Am нужен, только когда говоришь, какой ты: готов, устал, счастлив. Если говоришь о действии — «я работаю», «я читаю», — am не ставится: I work. Сказать I am work — ошибка.
Пока запомни одну заготовку: I am + какой ты. I («я») всегда пишется с большой буквы.
О других людях связка звучит по-другому: «ты» — you are, «она» — she is, «он» — he is, «мы» — we are. Это разберём дальше в уроке, по одному шагу.
Goal: Сказать, какой ты сейчас: «Я готов», «Я устал». Потом — «Я не готов» и «Ты готов?».
Scene caption why: В обеих фразах она говорит не о том, что делает, а о том, какая она сейчас. Между I («я») и словом ready или tired стоит am. По-русски на этом месте ничего нет — зачем am нужен, объясняем ниже.

## Rules
1. Plain spoken Russian, short sentences. A concrete everyday situation first, then the rule.
2. Every English word/phrase the learner may not know gets a Russian translation the first time it
   appears in a text: «I work — я работаю», «book (книга)». English examples always paired with Russian.
3. No grammar terms without an instant plain explanation (подлежащее, вспомогательный глагол,
   артикль, исчисляемое…). Prefer no term at all; if a term is useful later, introduce it once:
   «a и the — это артикли: маленькие слова перед предметом».
4. Say what each new little word IS and what it does in this sentence. Address the obvious confusion
   a Russian speaker will have (e.g. "do" in questions means nothing by itself; "-s" in works is not
   a plural).
5. State the limits of each rule: when it applies and when it does NOT, with a counter-example.
6. No vague forward references ("разберём ниже", "дальше будет"). If something comes later, name it
   concretely in one line or leave it out.
7. Don't overload: the first section ≤ 6 short paragraphs; later sections 1–3 short paragraphs.
   No repetition of the same point across sections (the owner hates repetition).
8. Only American English. Examples must use only grammar taught in this or earlier lessons
   (lesson order above) — don't sneak in Present Perfect, etc.
9. Keep `«»` quotes and `—` dashes style as in the file. Russian «ё» where the file uses it.
10. Keep the lesson's teaching content and order (what is taught, which tasks exist). You are
    improving how it is explained, not redesigning the lesson.

## What you may change
- lesson.goal (one line, see above)
- lesson.subtitle only if it's unclear (keep short)
- every lesson.sections[i].title / body (keep the SAME number of sections, same order/topic each)
- lesson.examples[i].why (keep en/ru unless the ru translation is wrong)
- each exercise's guidance.title / guidance.body / guidance.translation, hint, explanation, and
  prompt ONLY if the prompt is unclear — never change answers / accepted answers / kind / id /
  revision, and a changed prompt must still expect exactly the same answers.
- If the lesson has a scene in course-guide.js (path-present-continuous→habit, path-articles-basic→
  articles, path-plurals→count override inside lessonVisual(), path-countability→count): propose a new
  scene `title` and `why` in the same spirit as the reference (say what is on the left/right in plain
  words, point at the exact English word that matters, no teasers). Do not edit course-guide.js.

## Output — do NOT edit repo files
Write ONE JSON file to the scratchpad path given in your task, UTF-8, shape:
{
  "id": "<lesson id>",
  "goal": "...",
  "subtitle": "... (omit if unchanged)",
  "sections": [{"title":"...","body":"..."}, ...],          // full list, same length as now
  "examples": [{"why":"..."}, ...],                           // full list, same length as now
  "exercises": {"<exercise id>": {"prompt"?:..., "hint"?:..., "explanation"?:..., "guidance"?: {"title"?:...,"body"?:...,"translation"?:...}}},
  "scene": {"title":"...","why":"..."}                        // only if the lesson has a scene
}
Only include exercise fields you actually changed. Validate the file parses as JSON (python -c "import json;json.load(open(p,encoding='utf-8'))").
Do not run the project's tests or linters. Final reply: 3–5 lines on what was unclear and what you changed.

## Pass 2 was rejected (2026-10-05)
A second pass added researched analogies and "natural Russian" polish; the owner found it HARDER to
read and it was reverted to pass 1. Lesson text stays plain and literal. What they kept: a short
`keyRule` card at the top of each lesson (`{rule, example, check}`), written in the simplest words —
no abstractions like «одна из многих» / «та самая». Each rule: one plain sentence, one paired example.

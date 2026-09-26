# Brief for lesson authors (course rewrite, September 2026)

You rewrite lessons of a personal American English course for a Russian-speaking adult who starts from zero (A1) and goes to C2. The learner reads your Russian explanations and answers in English. The learner's complaint about the current course: repeated text, filler, heavy academic Russian, tasks that jump ahead of what was taught, two parallel explanations of the same thing, British English. Your lesson must fix all of that.

Work in the worktree `C:\Users\Патриарх\Desktop\english-learning\.claude\worktrees\english-course-quality-cb664b` (run commands from its `app` directory). **Only create/edit your own staged files** `app/course-rewrite/stage/<lesson-id>.json`. Never edit `app/content/**`, code, tests or other agents' files. Do not run the apply script, do not start servers, do not commit.

## Read first

1. `app/docs/COURSE-STANDARD.md` — the standard (binding).
2. Gold examples: `app/course-rewrite/stage/path-be.json` and `app/course-rewrite/stage/path-articles-basic.json`. Match their tone, density, step size, hint style and JSON shape.
3. The current version of your lesson as the learner sees it: `python scripts/render_course_lesson.py <lesson-id>` (shows the old overlay too). Reuse good ideas, facts, names and materials; drop repetition and filler.
4. What the learner already knows at your lesson: `python scripts/course_syllabus.py <lesson-id>`. Lessons marked NEW are described below.
5. If your lesson has a built-in diagram, it is in `app/studio/visuals-basic.js` or `visuals-advanced.js` (keyed by lesson id). Keep it (omit `visual`) if it still matches your lesson, or supply a better `visual` object. Scenes/illustrations are listed in `app/studio/course-guide.js` (`mapped`); keep the lesson consistent with its scene.

## What to produce

One JSON object per lesson, shape exactly as in the gold examples: `id, title, subtitle, level, group, units, minutes, goal, formula, guided: true, introSections, (introExamples), prerequisites, recycles, teaches, sources, (visual), sections, examples, (materials), exercises`. Exercise fields: `id` (e1…eN), `kind` (translate | rewrite | write | speak), `practiceStage` (guided | independent), `prompt`, `context`, `guidance` (guided only: title, body, example, translation), `hint`, `answers`, `explanation`, `materialIds` (if used). Never set `revision`.

Write the file as UTF-8 JSON with 2-space indentation.

## Non-negotiables

- **One explanation layer.** Theory lives in `sections`. Guidance cards introduce the one new move of *this* step in 1–3 sentences; they never copy or paraphrase a whole section. Hints give a *different* kind of help (a starter like «Начни так: Does she…», a check question, a key word) — never the card text, goal or formula. No boilerplate `context`; empty string if nothing to add.
- **Plain Russian, «ты».** Short sentences. Gloss every new English word on first use at A1–B1 (`tired — устал`). Name a grammar term only together with its plain meaning. No bureaucratic or meta words (see the standard).
- **Nothing ahead of the learner.** Tasks may use only forms taught in your lesson or earlier lessons (check the syllabus). New vocabulary is glossed in the prompt or context. If a task needs a chunk from a later topic, teach it as a fixed phrase in the step card or change the task.
- **Progression inside the lesson.** Each guided task adds exactly one new move. Then contrast / error-spotting, then a recycling task («Вспоминаем…», ids in `recycles`), then 2–3 independent tasks with a real purpose and addressee (message, answer about yourself, speaking). No two tasks that differ only by a swapped noun. The guidance example must be parallel but must not be the task's answer.
- **Answers.** English only; list natural variants (contractions and full forms, word-order/synonym variants). Open tasks: 1–2 short model answers with no commentary inside (commentary goes to `explanation`). `explanation` = 1–3 sentences: why, and which variants are also right.
- **American English only** in examples, answers, materials, guidance examples: spelling, vocabulary, $, «May 6», «6:30 p.m.», (312) 555-0147 phone numbers (555-01xx), Mr./Dr. with a period, "Do you have…?", "on the weekend". A British form may be *mentioned* in Russian explanation only when it helps understanding.
- **Protected materials**: a material with `audioFile`, `sourceUrl`, `inputSkill` or `figure` is a real recording/transcript/figure — copy it byte-for-byte, same id. Other materials you may rewrite (keep ids m1, m2… that tasks use).
- **Sources**: 1–3 per lesson, actually opened with WebFetch (grammar reference such as VOA Learning English, Cambridge Dictionary grammar, Merriam-Webster, Purdue OWL, British Council for shared grammar; a Russian-language teacher explanation such as englex.ru/skyeng/puzzle-english; a learner discussion if you find a good one). `notes` say what you checked. Do not copy source text. Verify the rule you teach; American usage wins over British notes.
- **Listening and reading lessons**: when a lesson is built on a recording or a text, at least one independent task (no card) must check understanding of that material — e.g., listen again without the transcript and pass the key facts to someone. The skill map only counts independent tasks as evidence.
- **Recycles**: from the third lesson of the route on, at least one guided task reuses 1–2 earlier lessons; list their ids in `recycles` (must be earlier in the route).

## Check before you finish

1. `python scripts/course_standard_lint.py course-rewrite/stage/<id>.json` → 0 errors. Read every warning and fix it unless it is a false alarm.
2. `python scripts/render_course_lesson.py course-rewrite/stage/<id>.json` → read it top to bottom as the learner. Ask: Is each step's new move clear? Could a learner at this point in the route do this task? Is anything said twice? Is every English sentence natural American English and correct? Are all acceptable answers listed?
3. Final reply (short!): per lesson 3–5 lines — the teaching idea, task sequence in one line, sources, any doubt you want the editor to decide. Do not paste the JSON.

## New lessons in the route (not written yet unless you are assigned them)

- `path-this-that` (A1, #5, after plurals): this/that/these/those — near vs far, one vs many; «это» by pointing (this/that) vs an already known thing (it); Is this…? / What is that? not yet (what comes in questions-basic) — use Is this/that…?; this + noun (this pen).
- `path-something-anything` (A2): something/anything/nothing, somebody/anybody/nobody, everywhere… with positive/negative/question.
- `path-me-too` (A2): Me too / Me neither, I do too / I don't either, So do I / Neither do I, reply with the right auxiliary (am/do/can/have).
- `path-adverbs-manner` (A2): quickly, slowly, carefully; good vs well; hard/fast; adverb after the object.
- `path-question-tags` (B1): …, isn't it? / …, don't you? / …, right? (very common in American speech), intonation up = real question, down = seeking agreement.

## Beginner chain (A1–A2 core lessons; `prerequisites` = exactly the previous one)

A1: path-be → path-sound-basics → path-articles-basic → path-plurals → path-this-that → path-present-simple → path-pronouns → path-possession → path-questions-basic → path-present-continuous → path-there-is → path-countability → path-place-time → path-requests-can → path-instructions → path-adjectives-frequency →
A2: path-past-simple → path-past-continuous → path-something-anything → path-future-simple → path-future-plans → path-present-perfect → path-me-too → path-comparatives → path-adverbs-manner → path-past-habits → path-obligation → path-zero-first → path-gerund-infinitive → path-relative-basic → path-connectors-basic → path-everyday-phrasal → path-listening-routine → path-email-basic.

All these core A1–A2 lessons are beginner lessons: keep `"beginner": true`, and 2–3 independent tasks at the end. A new A1–A2 core lesson must also include a `visual` (2–4 item comparison diagram), because every foundation lesson has one.

Applied lessons (research-*, extended-*, natural-*) list the 1–4 earlier lessons they really build on.

Keep the lesson's `group` value unless it is clearly wrong: the program page groups neighboring lessons by it.

## B1–B2 level notes

- The learner knows A1–A2: all basic tenses incl. past continuous, will/going to, present perfect, comparatives, adverbs, used to, obligation, zero/first conditional and time clauses, gerund/infinitive, relative clauses, connectors, phrasal verbs, something/anything, Me too/So do I. Build on it; never re-teach it.
- Russian stays plain. A grammar name (Present Perfect Continuous, passive) may be used, but the meaning comes first in ordinary words.
- `introSections` = all sections (usually 3–5): at B1+ the intro is the full explanation. Guidance cards are then short focus notes for the step (1–2 sentences, ≤50 words) and never re-explain the theory.
- 9–12 tasks: 5–7 guided steps (one move each: form → contrast with the neighbor form → error spotting → recycling), then 3 independent tasks: a real writing task with purpose, addressee and a content checklist (B1 60–120 words, B2 100–180), a speaking task with a checklist (B1 30–60 seconds, B2 1–2 minutes), and optionally editing a realistic text.
- Model answers are short natural texts within those limits. Delete all old meta text from answers and explanations («Illustrative starting situation», «Invented draft excerpt», «No learner recording…», «Иллюстративный образец…»). Explanations name the criteria («Засчитывается, если…»).
- If two lessons cover neighboring ground (e.g., connected speech → connected boundaries → listening decoding), the later one names what it adds and builds on the earlier one instead of repeating it.

## Sources when web search is unavailable

The session's WebSearch budget may be exhausted. Then open known reference pages directly with WebFetch, for example: learningenglish.voanews.com (Everyday Grammar), learnenglish.britishcouncil.org/grammar/…, owl.purdue.edu/owl/…, englex.ru/…, dictionary.com, merriam-webster.com (may block), grammarly.com/blog/…, perfect-english-grammar.com. Cite only pages you actually opened. If a lesson's old version already lists verified sources, you may re-check and keep them.

## A2 level notes

The A2 learner knows all of A1 (be, articles, plurals, this/that, present simple, pronouns and 's, have, wh-questions, spelling/numbers, present continuous, there is, some/any/much/many, in/on/at, can, imperatives, adjectives and frequency adverbs). A2 explanations can be a little longer, but stay plain. From A2 on every lesson has at least one speaking task. Open answers: 2–5 sentences; speaking: 3–5 sentences or about 30 seconds.

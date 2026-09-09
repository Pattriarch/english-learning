// Моки всех ответов API. Включаются через ?mock=1 (см. api.js).
import { mockLesson } from './mocklesson.js';
import { ApiError } from './api.js';

const T = (id, book, unit, category, title, title_ru, level, usage, study, extra = {}) => ({
  topic: { id, book, unit, category, title, title_ru, level },
  usage_status: usage,
  study_status: study,
  counts: Object.assign(
    { letter_error: 0, letter_ok: 0, letter_error_30d: 0, letter_ok_30d: 0, ex_pass: 0, ex_fail: 0, theory_read: 0 },
    extra.counts || {}
  ),
  has_lesson: !!extra.has_lesson,
  scene_idx: extra.scene_idx || 0,
  score: extra.score || { passed: 0, failed: 0, streakBest: 0, done: false },
});

export const mockTopics = [
  T('egiu-004', 'egiu', '4', 'Present and past', 'Past continuous (I was doing)', 'что происходило в момент', 'B1', 'active', 'mastered',
    { has_lesson: true, counts: { letter_ok: 6, letter_ok_30d: 4, ex_pass: 11, ex_fail: 1 }, score: { passed: 11, failed: 1, streakBest: 7, done: true } }),
  T('egiu-007', 'egiu', '7', 'Present perfect and past', 'Present perfect 1 (I have done)', 'результат виден сейчас', 'B1', 'shaky', 'started',
    { has_lesson: true, counts: { letter_error: 2, letter_ok: 3, letter_error_30d: 1, letter_ok_30d: 2, ex_pass: 4, ex_fail: 2 }, score: { passed: 4, failed: 2, streakBest: 3, done: false }, scene_idx: 2 }),
  T('egiu-013', 'egiu', '13', 'Present perfect and past', 'Present perfect vs past simple', 'уже сделал vs сделал тогда', 'B1', 'struggling', 'started',
    { has_lesson: true, counts: { letter_error: 9, letter_ok: 2, letter_error_30d: 5, letter_ok_30d: 1, ex_pass: 3, ex_fail: 4 }, score: { passed: 3, failed: 4, streakBest: 2, done: false } }),
  T('egiu-021', 'egiu', '21', 'Future', 'I will vs I\'m going to', 'решил сейчас vs собирался', 'B1', 'struggling', 'untouched',
    { counts: { letter_error: 6, letter_error_30d: 4, letter_ok: 1 } }),
  T('egiu-026', 'egiu', '26', 'Modals', 'Must and can\'t (deduction)', 'уверенный вывод', 'B2', 'unknown', 'untouched'),
  T('egiu-038', 'egiu', '38', 'Conditionals', 'If I knew / I wish I knew', 'нереальное настоящее', 'B2', 'shaky', 'completed',
    { has_lesson: true, counts: { letter_error: 1, letter_ok: 2, letter_error_30d: 1, letter_ok_30d: 1, ex_pass: 6, ex_fail: 3 }, score: { passed: 6, failed: 3, streakBest: 4, done: true } }),
  T('egiu-071', 'egiu', '71', 'Articles', 'A/an and the', 'артикли, вечная боль', 'B1', 'struggling', 'started',
    { has_lesson: true, counts: { letter_error: 14, letter_error_30d: 8, letter_ok: 4, letter_ok_30d: 2, ex_pass: 5, ex_fail: 5 }, score: { passed: 5, failed: 5, streakBest: 3, done: false }, scene_idx: 1 }),
  T('egiu-103', 'egiu', '103', 'Prepositions', 'At/on/in (time)', 'предлоги времени', 'B1', 'shaky', 'untouched',
    { counts: { letter_error: 3, letter_error_30d: 1, letter_ok: 4, letter_ok_30d: 3 } }),
  T('egiu-121', 'egiu', '121', 'Reported speech', 'Sequence of tenses', 'согласование времён', 'B2', 'unknown', 'untouched'),
  T('essential-042', 'essential', '42', 'Basics', 'There is / there are', 'есть / имеется', 'A2', 'active', 'untouched',
    { counts: { letter_ok: 9, letter_ok_30d: 5 } }),
  T('phrasal-up', 'phrasal', '', 'Work and projects', 'Phrasal verbs with UP', 'wrap up, catch up, own up', 'B2', 'shaky', 'started',
    { has_lesson: true, counts: { letter_error: 2, letter_error_30d: 1, letter_ok: 3, letter_ok_30d: 2, ex_pass: 2, ex_fail: 1 }, score: { passed: 2, failed: 1, streakBest: 2, done: false } }),
  T('phrasal-out', 'phrasal', '', 'Work and projects', 'Phrasal verbs with OUT', 'figure out, roll out, burn out', 'B2', 'unknown', 'untouched'),
  T('phrasal-social', 'phrasal', '', 'People', 'Hang out, hit up, blow off', 'социальные фразовые', 'B2', 'unknown', 'mastered',
    { has_lesson: true, counts: { ex_pass: 12, ex_fail: 1 }, score: { passed: 12, failed: 1, streakBest: 9, done: true } }),
  T('colloc-meetings', 'colloc', '', 'Work', 'Collocations: meetings', 'set up a call, drop a note', 'B2', 'active', 'untouched',
    { counts: { letter_ok: 7, letter_ok_30d: 4 } }),
  T('colloc-money', 'colloc', '', 'Money', 'Collocations: money', 'split the bill, pick up the tab', 'B2', 'unknown', 'untouched'),
  T('vocab-apartment', 'vocab', '', 'Housing', 'Renting an apartment (AmE)', 'аренда по-американски', 'B2', 'shaky', 'untouched',
    { counts: { letter_error: 1, letter_error_30d: 1, letter_ok: 2, letter_ok_30d: 1 } }),
  T('vocab-health', 'vocab', '', 'Health', 'Doctor\'s office', 'к врачу без паники', 'B2', 'unknown', 'untouched'),
  T('slang-smalltalk', 'slang', '', 'Разговорное', 'Small talk и реакции', 'bet, no cap, it\'s giving', 'B2', 'active', 'started',
    { has_lesson: true, counts: { letter_ok: 5, letter_ok_30d: 3, ex_pass: 3, ex_fail: 1 }, score: { passed: 3, failed: 1, streakBest: 3, done: false } }),
  T('slang-work', 'slang', '', 'Разговорное', 'Сленг на работе', 'что можно сказать техлиду', 'B2', 'unknown', 'untouched'),
];

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();

function countBy(key) {
  const out = {};
  for (const t of mockTopics) out[t[key]] = (out[t[key]] || 0) + 1;
  return out;
}

export const mockStats = {
  topics: mockTopics.length,
  letters: 3,
  anki_queue: 14,
  anki_exported: 96,
  usage: Object.assign({ active: 0, shaky: 0, struggling: 0, unknown: 0 }, countBy('usage_status')),
  study: Object.assign({ mastered: 0, completed: 0, started: 0, untouched: 0 }, countBy('study_status')),
  streak: 12,
  last_letter_at: daysAgo(0),
  botLink: 'https://t.me/english_output_bot',
  weak_topics: mockTopics
    .filter((t) => t.usage_status === 'struggling')
    .map((t) => ({ topic_id: t.topic.id, title: t.topic.title, title_ru: t.topic.title_ru, errors: t.counts.letter_error_30d })),
};

const mockEvents = {
  'egiu-013': [
    { id: 41, topic_id: 'egiu-013', kind: 'letter_error', letter_id: 3, detail: 'I have finished it yesterday', created_at: daysAgo(0) },
    { id: 38, topic_id: 'egiu-013', kind: 'ex_fail', detail: 'radar: Have you had your lunch already?', created_at: daysAgo(2) },
    { id: 33, topic_id: 'egiu-013', kind: 'letter_error', letter_id: 2, detail: "we've moved in March", created_at: daysAgo(4) },
    { id: 29, topic_id: 'egiu-013', kind: 'ex_pass', detail: 'case: шаг 2', created_at: daysAgo(6) },
    { id: 21, topic_id: 'egiu-013', kind: 'letter_ok', letter_id: 1, detail: "I've lived here for two years", created_at: daysAgo(11) },
    { id: 14, topic_id: 'egiu-013', kind: 'letter_error', letter_id: 1, detail: 'I have seen him last night', created_at: daysAgo(11) },
    { id: 9, topic_id: 'egiu-013', kind: 'theory_read', detail: '', created_at: daysAgo(19) },
  ],
  'egiu-071': [
    { id: 40, topic_id: 'egiu-071', kind: 'letter_error', letter_id: 3, detail: 'I went to the work', created_at: daysAgo(0) },
    { id: 30, topic_id: 'egiu-071', kind: 'letter_error', letter_id: 2, detail: 'she is doctor', created_at: daysAgo(4) },
  ],
  'egiu-021': [
    { id: 39, topic_id: 'egiu-021', kind: 'letter_error', letter_id: 3, detail: "I will call you back, I promise — but I'm going to", created_at: daysAgo(1) },
  ],
};

const theories = {
  'egiu-013': mockLesson.theory,
  'egiu-071':
    '## Артикли за три правила\n\n' +
    '1. Слушатель уже знает, о чём речь → `the`.\n' +
    '2. Не знает, но предмет исчисляемый и один → `a/an`.\n' +
    '3. Общее понятие во множественном или неисчисляемое → без артикля.\n\n' +
    'Русская привычка ронять артикли даёт `I went to work` (верно) и `I went to the store` (тоже верно) — ' +
    'но `she is doctor` уже ломает фразу: нужен `a doctor`.',
};

export const mockLetters = [
  {
    id: 3,
    created_at: daysAgo(0),
    prompt: 'Напиши коллеге, почему релиз сдвигается на неделю.',
    topics_ok: ['egiu-004', 'colloc-meetings'],
    original:
      "Hi Jake,\n\nI have finished the auth part yesterday but the token refresh is still broken. " +
      "I went to the work early today and spent 3 hours on it. I think we will need one more week.\n\nBest,\nAlex",
    analysis: {
      corrected:
        "Hi Jake,\n\nI finished the auth part yesterday, but the token refresh is still broken. " +
        "I came in early today and spent three hours on it. I think we'll need one more week.\n\nBest,\nAlex",
      errors: [
        { quote: 'I have finished the auth part yesterday', fix: 'I finished the auth part yesterday', explain_ru: 'yesterday убивает перфект', topic_id: 'egiu-013' },
        { quote: 'I went to the work', fix: 'I came in', explain_ru: 'work без артикля; в офис — came in', topic_id: 'egiu-071' },
        { quote: 'I think we will need', fix: "I think we'll need", explain_ru: 'в переписке сокращают, полное will звучит официально', topic_id: 'egiu-021' },
      ],
      upgrades: [
        { quote: 'the token refresh is still broken', better: "the token refresh is still giving me trouble", why_ru: 'мягче для статус-апдейта, не звучит как капитуляция' },
      ],
      russian_inserts: [],
      slang_bonus: { phrase: 'cooked', meaning_ru: 'всё, приплыли', example: "if QA finds one more bug we're cooked" },
      cards: [{ front: 'я закончил вчера', back: 'I finished it yesterday', note: 'past simple с yesterday', topic_id: 'egiu-013' }],
    },
  },
  {
    id: 2,
    created_at: daysAgo(4),
    prompt: 'Напиши риелтору про квартиру, которую смотрел вчера.',
    topics_ok: ['vocab-apartment'],
    original:
      "Hello Rachel,\n\nWe've moved in March so we need something quick. The apartment which I have seen " +
      'yesterday was good but the kitchen мелковата. Can we look at another one?',
    analysis: {
      corrected:
        "Hello Rachel,\n\nWe're moving in March, so we need something quick. The apartment I saw yesterday " +
        'was good, but the kitchen is on the small side. Can we look at another one?',
      errors: [
        { quote: "We've moved in March", fix: "We're moving in March", explain_ru: 'переезд в будущем, перфект тут вообще не про то', topic_id: 'egiu-013' },
        { quote: 'The apartment which I have seen yesterday', fix: 'The apartment I saw yesterday', explain_ru: 'which лишнее + yesterday требует past simple', topic_id: 'egiu-013' },
      ],
      upgrades: [
        { quote: 'was good', better: 'worked for us', why_ru: 'good — пустое слово, американец скажет конкретнее' },
      ],
      russian_inserts: [
        { ru: 'мелковата', en: 'is on the small side', alt: 'is kinda tiny' },
      ],
      slang_bonus: null,
      cards: [{ front: 'кухня мелковата', back: "the kitchen is on the small side", note: 'смягчение оценки', topic_id: 'vocab-apartment' }],
    },
  },
  {
    id: 1,
    created_at: daysAgo(11),
    prompt: 'Расскажи другу, как прошли выходные.',
    topics_ok: ['egiu-013', 'slang-smalltalk'],
    original: "Hey Danny,\n\nI've lived here for two years and I have seen him last night at the bar on Ashland.",
    analysis: {
      corrected: "Hey Danny,\n\nI've lived here for two years and I saw him last night at the bar on Ashland.",
      errors: [
        { quote: 'I have seen him last night', fix: 'I saw him last night', explain_ru: 'last night — закрытая точка', topic_id: 'egiu-013' },
      ],
      upgrades: [],
      russian_inserts: [],
      slang_bonus: { phrase: 'lowkey', meaning_ru: 'типа, слегка', example: 'lowkey the best bar on Ashland' },
      cards: [],
    },
  },
];

// --- роутер ---

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

export async function mockRoute(path, opts) {
  await delay();
  const url = path.split('?')[0];
  if (opts && opts.method === 'POST' && url === '/api/progress') {
    const body = JSON.parse((opts && opts.body) || '{}');
    return mockTopics.find((x) => x.topic.id === body.topicId) || { ok: '1' };
  }
  if (url === '/api/stats') return mockStats;
  if (url === '/api/topics') return mockTopics;
  if (url === '/api/letters') return mockLetters;

  let m = /^\/api\/topics\/(.+)$/.exec(url);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const t = mockTopics.find((x) => x.topic.id === id);
    if (!t) throw new ApiError(404, 'topic not found');
    return {
      topic: t.topic,
      theory: theories[id] || '',
      events: mockEvents[id] || [],
      has_lesson: t.has_lesson,
      has_progress: !!t.has_lesson,
      progress: t.has_lesson ? { topic_id: id, scene_idx: t.scene_idx || 0, score: t.score, updated_at: daysAgo(1) } : undefined,
    };
  }
  m = /^\/api\/lessons\/(.+)$/.exec(url);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const t = mockTopics.find((x) => x.topic.id === id);
    if (!t || !t.has_lesson) throw new ApiError(404, 'lesson not found');
    return Object.assign({}, mockLesson, { topicId: id, title: t.topic.title, title_ru: t.topic.title_ru, theory: theories[id] || mockLesson.theory });
  }
  throw new ApiError(404, 'mock: нет маршрута ' + url);
}

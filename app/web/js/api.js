// Обёртка над fetch. ?mock=1 — отвечают моки из mockdata.js, сервер не нужен.

const params = new URLSearchParams(location.search);
export const isMock = params.has('mock') && params.get('mock') !== '0';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let mockRouter = null;
async function mock(path, opts) {
  if (!mockRouter) mockRouter = (await import('./mockdata.js')).mockRoute;
  return mockRouter(path, opts);
}

async function req(path, opts) {
  if (isMock) return mock(path, opts);
  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    throw new ApiError(0, 'сервер недоступен');
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || res.statusText || 'ошибка');
  return data;
}

export const getStats = () => req('/api/stats');
export const getTopics = () => req('/api/topics');
export const getTopic = (id) => req('/api/topics/' + encodeURIComponent(id));

export async function getLesson(topicId) {
  try {
    return await req('/api/lessons/' + encodeURIComponent(topicId));
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export const getLetters = () => req('/api/letters');

/** Не роняет урок, если сервер недоступен: прогресс — дело второе. */
export function postProgress(body) {
  return req('/api/progress', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch((e) => {
    console.warn('progress не сохранён:', e.message);
    return null;
  });
}

/** Стартовая сцена урока из ответа /api/topics/{id}: поле может называться по-разному. */
export function lessonStart(topicData) {
  const p = topicData && (topicData.lesson_progress || topicData.lessonProgress || topicData.progress);
  if (!p || typeof p !== 'object') return { sceneIdx: 0, score: null };
  const idx = p.scene_idx ?? p.sceneIdx ?? 0;
  return { sceneIdx: Number.isFinite(idx) ? idx : 0, score: p.score || null };
}

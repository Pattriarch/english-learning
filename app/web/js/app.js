import { route, start } from './router.js';
import { isMock } from './api.js';
import { dashboard } from './views/dashboard.js';
import { topics } from './views/topics.js';
import { topic } from './views/topic.js';
import { lesson } from './views/lesson.js';
import { letters } from './views/letters.js';

route('/', dashboard);
route('/topics', topics);
route('/topic/:id', topic);
route('/lesson/:id', lesson);
route('/letters', letters);

if (isMock) {
  document.querySelector('.brand').insertAdjacentHTML('afterend', '<span class="tag">mock</span>');
  // моковые ссылки должны сохранять ?mock=1 — hash-роутинг это делает сам
}

start(document.getElementById('app'));

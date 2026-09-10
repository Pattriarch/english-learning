# Шесть пространств для английского

Откройте `http://127.0.0.1:8777/#/designs`. «Примерить дизайн» применяет вариант ко всему приложению и открывает его главную страницу. Кнопка солнца/луны переключает светлую и тёмную тему. Выбор сохраняется в localStorage текущего браузера; учебный прогресс остаётся общим серверным JSON.

| Вариант | Компоновка и характер |
|---|---|
| Cobalt Bento | Крупная обложка слева, выразительные показатели, учебный ритм, модульные карточки. |
| The English Journal | Журнальные колонки, заголовки с засечками, тонкие разделители, тёплая бумага. |
| After Hours | Киноклуб занимает первый широкий экран; янтарь, тёплый тёмный фон. |
| Language Studio | Верхняя навигация на широком экране, рабочие панели, лавандовая палитра. |
| Quiet Progress | Центральная цель, широкая обложка, спокойные зелёные поверхности. |
| Swiss Index | Открытая строгая сетка, крупные номера, прямые углы, красный акцент. |

Все варианты имеют светлую и тёмную палитру. Общие формы, теория, обратная связь, библиотека и рабочие тетради используют цвета выбранной темы. Адаптивная вёрстка сохраняет функции на узких экранах; анимация отключается при `prefers-reduced-motion`.

В Cobalt Bento основные показатели на компьютере набраны размером 64–80 px, подписи — 14–15 px, длительность этапов — 22 px. Сетка перестраивается раньше, чтобы сохранить читаемость; на телефоне до 420 px карточки показателей занимают всю ширину. Эти настройки находятся в отдельном `app/studio/bento.css` и применяются только к первому варианту.

Ориентиры: предоставленное пользователем приложение «Драйв» из `Downloads/pdd`, особенно `design/mockups/app/mockup-1.html` и `mockup-2.html`: шрифт Onest, умеренные веса, чистые карточки. Дополнительно изучены [обновление Linear 2026](https://linear.app/now/behind-the-latest-design-refresh) — спокойные поверхности и предсказуемое расположение действий — и [типографическая система Geist](https://vercel.com/geist/typography). Это опорные принципы, а не утверждение о единственном модном стиле.

Onest хранится локально в `app/studio/assets/fonts/Onest.ttf`; лицензия OFL лежит рядом. Источник — [репозиторий Google Fonts](https://github.com/google/fonts/tree/main/ofl/onest). Во время работы приложение не обращается к внешнему CDN шрифтов.

## Собственная обложка

Файл: `app/studio/assets/workshop-hero.png`. Создан встроенным Image Generator и скопирован в проект. SVG-марка и функциональные иконки остаются векторными.

Точный промпт:

> Use case: stylized-concept. Asset type: hero artwork for a premium personal English study app, project English Workshop. Create one wide cinematic editorial still life, 1536x1024 landscape. A sculptural cobalt-blue open book folded into an impossible architectural stairway, warm off-white pages, one burnt-orange bookmark ribbon, a small satin silver sphere, arranged on a dark charcoal desk. Beautiful tactile paper grain and matte ceramic-like cover, strong side lighting and soft shadows, art-directed Swiss design studio photography with restrained surrealism. Compose the objects primarily in the right half, generous dark negative space at left for separately rendered UI copy. Elegant and adult, no childish cartoon, no neon, no glow, no gradients painted as background, no floating app interfaces, no lettering, no text, no logos, no watermark. Crisp highly crafted photograph, graphic shapes and confident composition, suitable for dark and light dashboard hero crop.

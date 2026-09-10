# Better Call Saul: источники английских субтитров

Проверено: **9 сентября 2026, 18:43 UTC**. Машиночитаемый каталог: `app/content/subtitle-sources.json`. Покрытие: **все 10 эпизодов первого сезона**. Здесь сохранены метаданные и ссылки; реплики сериала и файлы субтитров в репозиторий не добавлены.

## Локальный комплект: проверка 10 сентября 2026

Архив TVsubtitles **скачан обычным GET после установки cookies сервером** и установлен для локального обучения: 10 английских SRT, 6 995 реплик. Учётная запись и платёж не использовались. SHA-256 архива: `d9edc930dc7aa81e208e5b7e5a9b03c454a377de2812e8556cbf0da7251b498a`.

Установщик проверил CRC архива, ровно десять ожидаемых номеров эпизодов, отсутствие путей вне каталога и наличие временных меток. UTF-8 и Windows-1252 приведены к UTF-8 с сохранением исходных хешей и названий в локальном манифесте. Затем настоящий JS-парсер приложения прочитал все файлы: по эпизодам **818, 612, 697, 709, 781, 597, 745, 781, 570, 685** реплик. Числа совпали с манифестом; перед открытием браузер проверяет хеш файла.

Файлы лежат в `app/studio/cinema-subtitles/`, исходный ZIP — в `app/data/subtitles/`. Оба каталога исключены из Git. Подготовленный комплект открывается из киноклуба или медиатеки, поддерживает выбор эпизода и существующий сдвиг времени. **Видео не предоставлено: синхронизация с конкретным монтажом, точность английского текста на слух и полнота его соответствия всем звучащим репликам не проверены.** Аудио актёров в комплекте нет.

Ниже сохранены результаты первоначальной проверки 9 сентября; утверждение «байты не скачивались» относится только к той проверке.

## Первоначальная проверка 9 сентября

На [TVsubtitles найден комплект English S01](https://www.tvsubtitles.net/subtitle-1643-1-en.html), содержащий по описанию сайта **10 файлов SRT** в архиве `Better_Call_Saul - season 1.en.zip`. Кроме комплекта проверены отдельные английские страницы каждого эпизода. [Оглавление сезона](https://www.tvsubtitles.net/tvshow-1643-1.html) позволяет выбрать и другие языки.

Проверка доступа дала различающиеся результаты:

- Обращение к [Download комплекта](https://www.tvsubtitles.net/download-1643-1-en.html) без сессии вернуло HTTP 200 `text/html` с сообщением о необходимости включить cookies. Такой ответ нельзя считать ZIP.
- После обычного открытия страницы каталога с сохранением cookies, выданных сервером, **HEAD того же Download вернул HTTP 200 `application/zip`**. Учётная запись, логин или платёж не использовались; скрипты сайта не запускались.
- Это проверка доступности endpoint и типа ответа. Байты архива не скачивались: целостность, кодировка, содержание реплик и совпадение таймингов с пользовательским видео не проверены.

Практический путь: открыть страницу комплекта в обычном браузере → Download → распаковать ZIP → импортировать нужный `.srt` вместе со своим видео. В приложении лучше показывать ссылку на страницу каталога: голый download URL без cookie-сессии может вернуть HTML. Возможность `fetch` из другого origin не проверена.

## Эпизоды и версии

Первый столбец ссылок ведёт непосредственно на проверенную страницу английского файла. Все номера и названия сопоставлены с `cinema.json`. Релиз ниже взят из метаданных соответствующего файла, а не угадан по серии.

| Эпизод | Название | Версия TVsubtitles | Прямая страница файла | Резерв Addic7ed |
| --- | --- | --- | --- | --- |
| S01E01 | Uno | HDTV KILLERS | [English SRT](https://www.tvsubtitles.net/subtitle-110449.html) | [English подтверждён](https://www.addic7ed.com/serie/Better%20Call%20Saul/1/1/addic7ed) |
| S01E02 | Mijo | HDTV LOL | [English SRT](https://www.tvsubtitles.net/subtitle-110566.html) | [English подтверждён](https://www.addic7ed.com/serie/Better%20Call%20Saul/1/2/addic7ed) |
| S01E03 | Nacho | HDTV x264-LOL | [English SRT](https://www.tvsubtitles.net/subtitle-284710.html) | [English подтверждён](https://www.addic7ed.com/serie/Better%20Call%20Saul/1/3/addic7ed) |
| S01E04 | Hero | HDTV LOL | [English SRT](https://www.tvsubtitles.net/subtitle-114447.html) | [Проверить вручную](https://www.addic7ed.com/serie/Better%20Call%20Saul/1/4/addic7ed) |
| S01E05 | Alpine Shepherd Boy | HDTV x264-LOL | [English SRT](https://www.tvsubtitles.net/subtitle-285646.html) | [Проверить вручную](https://www.addic7ed.com/serie/Better%20Call%20Saul/1/5/addic7ed) |
| S01E06 | Five-O | HDTV x264-LOL | [English SRT](https://www.tvsubtitles.net/subtitle-286061.html) | [Проверить вручную](https://www.addic7ed.com/serie/Better%20Call%20Saul/1/6/addic7ed) |
| S01E07 | Bingo | Не указан | [English SRT](https://www.tvsubtitles.net/subtitle-286375.html) | [Проверить вручную](https://www.addic7ed.com/serie/Better%20Call%20Saul/1/7/addic7ed) |
| S01E08 | RICO | HDTV x264-LOL | [English SRT](https://www.tvsubtitles.net/subtitle-286685.html) | [English подтверждён](https://www.addic7ed.com/serie/Better%20Call%20Saul/1/8/addic7ed) |
| S01E09 | Pimento | HDTV x264-LOL | [English SRT](https://www.tvsubtitles.net/subtitle-287012.html) | [Проверить вручную](https://www.addic7ed.com/serie/Better%20Call%20Saul/1/9/addic7ed) |
| S01E10 | Marco | HDTV x264-LOL | [English SRT](https://www.tvsubtitles.net/subtitle-287513.html) | [Проверить вручную](https://www.addic7ed.com/serie/Better%20Call%20Saul/1/10/addic7ed) |

Пометка «проверить вручную» означает: URL построен по действующему шаблону Addic7ed, но попытка его открыть вернула ошибку инструмента. Это **не подтверждённое наличие файла** и не доказательство, что субтитров нет.

## Addic7ed

[Карточка сериала](https://www.addic7ed.com/show/4648/Better%20Call%20Saul) во время проверки показывала перегрузку сервера. При этом отдельные страницы [Uno](https://www.addic7ed.com/serie/Better%20Call%20Saul/1/1/addic7ed), [Mijo](https://www.addic7ed.com/serie/Better%20Call%20Saul/1/2/addic7ed), [Nacho](https://www.addic7ed.com/serie/Better%20Call%20Saul/1/3/addic7ed) и [RICO](https://www.addic7ed.com/serie/Better%20Call%20Saul/1/8/addic7ed) открылись с завершёнными английскими вариантами. Это полезный резерв для другого монтажа: у Uno подтверждены KILLERS, WEB.DL и PSYPHER с примечанием о REWARD; у трёх остальных — LOL и WEB.DL. На страницах есть варианты HI и без HI; HI включает дополнительные пометки о звуках. Другие языковые строки не использованы как доказательство существования английского варианта.

Согласно [официальному FAQ команды](https://www.sub-talk.net/topic/2784-frequently-asked-questions/), групповой **Multi Download требует входа**. [Страница лимита](https://www.addic7ed.com/downloadexceeded.php?why=2) указывает суточные ограничения; фактический остаток нужно смотреть в текущей сессии сайта. Файлы с Addic7ed не скачивались, поэтому для них не обещается проверенный формат или успешная автоматическая загрузка. Официальный публичный API в этой проверке не подтверждён.

## OpenSubtitles и Podnapisi

[Страница Better Call Saul S01 на OpenSubtitles.com](https://www.opensubtitles.com/en/tvshows/2015-better-call-saul/seasons/1) найдена в поиске, но прямое открытие вернуло **403 Forbidden**. Доступ к конкретным English-файлам этим не подтверждён. Ограничение не обходилось.

Для последующей интеграции существует официальный [REST API](https://opensubtitles.stoplight.io/docs/opensubtitles-api/). Администратор подтверждает [создание API key в собственной учётной записи](https://forum.opensubtitles.com/t/request-for-open-subtitles-api-key/2415/2) и [необходимость API key и User-Agent](https://forum.opensubtitles.com/t/message-you-cannot-consume-this-service/2371). Старый XML-RPC OpenSubtitles.org не стоит брать за основу новой интеграции: [29 января 2026 администратор объявил окончательное закрытие для сторонних приложений](https://forum.opensubtitles.com/t/opensubtitles-org-api-final-shutdown-notice-for-non-vip-users/5045). Доступ, квоты, тариф и логин для выбранного сценария потребуется проверять по актуальному аккаунту; «бесплатно и безлимитно» здесь не заявляется.

[Podnapisi](https://www.podnapisi.net) инструменту открыть не удалось. Подтверждённые страницы нужного сериала не найдены. Некоторые результаты относились к эпизоду **Better Call Saul внутри Breaking Bad**, а не к сериалу 2015 года; они исключены из каталога. Поэтому в JSON нет мнимых проверенных ссылок Podnapisi по эпизодам.

## Официальные CC и синхронизация

[Apple TV: Uno](https://tv.apple.com/us/episode/uno/umc.cmc.7ha901mh8lh5tnz62f5ocrdp5) явно указывает English (United States) CC. Это подтверждает субтитры при просмотре на платформе, но не отдельный скачиваемый SRT/VTT и не доступность в регионе пользователя.

После импорта проверить одну реплику в начале и одну ближе к концу видео. Одинаковая ошибка времени обычно исправляется общим сдвигом; нарастающее расхождение требует другой версии субтитров либо изменения масштаба времени; разрыв после сцены может означать иной монтаж. До такой проверки нельзя обещать, что HDTV LOL совпадает с WEB-DL или Blu-ray. Для Bingo релиз не указан: ориентироваться только на название файла недостаточно.

## Как читать JSON

- `verified: true` означает, что открытая страница действительно содержит English-метаданные нужного эпизода. Это не оценка точности перевода и не проверка всех таймкодов.
- `verified: false` отмечает резервный адрес, по которому подтверждение не получено. Пояснение лежит в `note`.
- `checkedAt` — время этой проверки. Сайты, ограничения и доступность файлов могут меняться.
- Поле `sourceId` связывает ссылку эпизода с общим описанием источника. ZIP сезона указан в основном источнике TVsubtitles, а отдельные English-файлы — в каждом эпизоде.

Локальная проверка проекта и приложенной папки `pdd` ранее в этой сессии не обнаружила файлов `.srt`, `.vtt`, `.ass` или `.ssa`. Это результат поиска в этих двух местах, а не на всём компьютере.

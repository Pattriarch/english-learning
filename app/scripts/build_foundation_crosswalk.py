"""Publish a bounded, editorial contents crosswalk. Does not generate lessons.

Mappings use our own short navigation labels and local lesson IDs, not publisher
exercises or texts. Run refresh_foundation_crosswalk.py after lesson publication.
"""
from __future__ import annotations
import json
from pathlib import Path

APP = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


PRON = {int(p["id"].split("-")[1]): p["id"] for p in read(APP / "content/pronunciation.json")["lessons"]}


def ids(value):
    result = []
    for token in value.split():
        if token.startswith("g:"):
            result.append(f"grammar-elementary-{int(token[2:]):03d}")
        elif token.startswith("v:"):
            result.append(f"vocabulary-elementary-{int(token[2:]):03d}")
        elif token.startswith("p:"):
            result.append(PRON[int(token[2:])])
        else:
            result.append(token)
    return result


def dim(kind, targets, coverage="mapped", note=""):
    return dict(kind=kind, coverage=coverage, targets=ids(targets), note=note)


def row(code, label, grammar, vocabulary, pronunciation, skills="", note="", skill_coverage="skill-transfer"):
    dimensions = [dim(k, t) for k, t in (("grammar", grammar), ("vocabulary", vocabulary),
                                        ("pronunciation", pronunciation)) if t]
    if skills:
        dimensions.append(dim("skills", skills, skill_coverage, note))
    return dict(code=code, label=label, dimensions=dimensions)


def a1():
    rows = [
        row("1A", "Первое знакомство", "g:1 g:2 path-be", "v:8 v:51 research-spelling-numbers", "p:3 p:5 p:9"),
        row("1B", "Откуда человек", "g:1 g:2", "v:27", "p:3 p:5 p:7 p:10"),
        row("2A", "Группа людей", "g:1 g:2 path-pronouns", "v:27", "p:10"),
        row("2B", "Уточнить данные", "g:44 g:47 path-questions-basic", "v:17 research-spelling-numbers", "p:14 research-spelling-numbers"),
        row("3A", "Называть предметы", "g:65 g:66 path-plurals", "v:47", "p:13"),
        row("3B", "Указать предмет", "g:74", "v:19 v:47", "p:8 p:15"),
        row("4A", "Чьи вещи", "g:60 g:64 path-possession", "v:1", "p:3 p:4 p:6"),
        row("4B", "Описывать свойства", "g:85", "v:56", "p:4 p:15"),
        row("5A", "Обычная жизнь", "g:5 g:6 path-present-simple", "v:10", "p:7 p:10"),
        row("5B", "Спросить о привычках", "g:7", "v:38 v:39 v:40 v:41", "p:9 p:15"),
        row("6A", "Человек и работа", "g:5 g:6 g:7", "v:14", "p:13"),
        row("6B", "Распорядок", "g:94 path-adjectives-frequency", "v:52 extended-a1-day", "p:9 p:15"),
        row("7A", "Свободное время", "g:44 g:47 path-questions-basic", "v:25", "p:5 p:9"),
        row("7B", "Обращение к собеседнику", "g:35 g:59 path-instructions path-pronouns", "v:24", "p:15"),
        row("8A", "Что получается", "g:30 path-requests-can", "v:49", "p:6"),
        row("8B", "Что нравится", "g:52 path-gerund-infinitive", "v:23 v:25", "p:4 p:9"),
        row("9A", "Что происходит", "g:3 g:4 path-present-continuous", "v:32", "p:15"),
        row("9B", "Сейчас и обычно", "g:8", "v:4", "p:3 p:4"),
        row("10A", "Где что находится", "g:37 g:106 g:109 path-there-is", "v:21", "p:5"),
        row("10B", "Где был", "g:10 g:103 g:106 path-place-time", "v:52 v:53", "p:6 p:15"),
        row("11A", "Событие в прошлом", "g:11 g:12 path-past-simple", "g:24", "p:12"),
        row("11B", "Частые формы прошлого", "g:11 g:12 g:24", "v:38 v:39 v:40 v:45", "p:15"),
        row("12A", "Рассказать о прошлом", "g:11 g:12 g:24", "v:49", "p:12 p:15"),
        row("12B", "Повторение прошлого", "g:11 g:12 g:24", "v:38 v:39 v:40", "p:3 p:4 p:5"),
        row("PE1", "Диктовать и уточнять", "", "v:21 research-spelling-numbers", "p:1 p:2", "extended-a1-registration research-spelling-numbers", "Свои регистрационные данные и уточнение; не гостиничный диалог издателя."),
        row("PE2", "Заказ и цена", "", "v:22 research-ordering-checkout", "p:5 p:7", "extended-a1-order", "Полный собственный заказ с исправлением и проверкой суммы."),
        row("PE3", "Время и самочувствие", "", "v:7 v:52", "p:4 p:11", "extended-a1-day extended-a1-notices", "Есть работа со временем и расписанием; отдельного диалога о самочувствии здесь нет.", "partial"),
        row("PE4", "Дата и звонок", "", "v:17 v:51 research-spelling-numbers", "p:8", "extended-a2-phone", "Есть подготовленный сценарий звонка; точка входа A2, не готовый диалог A1.", "partial"),
        row("PE5", "Пригласить и предложить", "g:34", "v:9", "p:15", "extended-a1-chat path-email-basic", "Согласование приглашения и письменный ответ на своих данных."),
        row("PE6", "Объяснить дорогу", "g:110 path-place-time", "v:29 v:53", "p:16", "path-place-time extended-a1-notices", "Есть собственный маршрут и поиск места; маршрут не проверяется по карте издателя.", "partial"),
    ]
    # A catalogue title alone does not prove its whole lexical bank was recreated.
    for code in ("3A", "3B", "5B", "8A"):
        match = next(x for x in rows if x["code"] == code)
        entry = next(d for d in match["dimensions"] if d["kind"] == "vocabulary")
        entry.update(coverage="partial", note="Есть подходящее семейство лексики; совпадение полного списка Vocabulary Bank не установлено.")
    return rows


def a2():
    return [
        row("1A", "Представиться", "g:5 g:6 g:7 path-present-simple", "v:14 v:15", "p:6 p:15", "extended-a1-registration extended-a1-day", "Собственные анкета и рассказ; работа проще исходного A2." , "partial"),
        row("1B", "О другом человеке", "g:5 g:6 g:7", "v:38 v:39 v:40 v:41", "p:13", "path-present-simple extended-a1-day", "Распорядок другого человека и вопросы; другие исходные тексты."),
        row("1C", "Общий план", "g:35 g:34", "v:7 v:52", "p:16", "extended-a1-chat extended-a2-relay", "Приглашение, реакция, согласование и передача обновлённой договорённости."),
        row("1D", "Люди рядом", "g:64 path-possession", "v:1", "", "vocabulary-elementary-001 path-possession", "Семья и принадлежность отрабатываются письменно и устно; видеоинтервью отсутствует.", "partial"),
        row("2A", "Покупки еды", "g:67 g:68 g:76 path-countability", "v:10", "p:6", "extended-a1-order path-countability path-connectors-basic", "Свой заказ и связный рассказ; иной текст и ситуация."),
        row("2B", "Как часто", "g:94 path-adjectives-frequency", "v:52", "p:15", "extended-a1-day path-present-simple", "Подготовленный распорядок и собственное описание; другой входной материал."),
        row("2C", "В кафе", "g:34 path-requests-can", "v:22", "p:16", "extended-a1-order research-ordering-checkout", "Собственный сценарий заказа, уточнения и исправления."),
        row("2D", "Любимое занятие", "g:52 path-gerund-infinitive", "v:25", "", "path-gerund-infinitive extended-a2-story", "Предпочтения и рассказ практикуются отдельно; исходного видео нет.", "partial"),
        row("3A", "Описать дом", "g:74 path-there-is", "v:11 v:12 v:13", "p:3", "path-there-is path-place-time", "Есть описание и расположение; нет отдельной работы с запятыми в тексте о доме.", "partial"),
        row("3B", "Вещи и свойства", "g:9 path-possession", "v:47 v:56", "p:14", "path-possession vocabulary-elementary-047", "Свои вещи и записка о найденном; другой текст для чтения."),
        row("3C", "Пригласить в гости", "g:34", "v:9", "p:15", "extended-a1-chat path-email-basic", "Готовая переписка о приглашении; отдельной анкеты о культуре гостей нет.", "partial"),
        row("3D", "Наш район", "g:37 path-there-is", "v:29", "", "path-place-time path-email-basic", "Свои ориентиры и письмо; нет исходного уличного видео.", "partial"),
        row("4A", "Когда это было", "g:10", "v:51 v:52", "p:6", "extended-a2-story path-past-simple", "Другой законченный рассказ с последовательностью событий."),
        row("4B", "Числа и уточнение", "g:47 g:83", "research-spelling-numbers", "p:14 p:16", "extended-a1-registration research-spelling-numbers", "Уточнение чисел на реальных полях задания; другая тема исходного сообщения."),
        row("4C", "Помочь с покупкой", "path-requests-can", "v:19 v:20", "p:15", "extended-a2-service extended-a2-relay", "Описание вещи, решение проблемы и передача сообщения; иная ситуация."),
        row("4D", "Посоветовать поездку", "g:32 g:35 path-instructions", "v:28 v:51", "", "extended-a2-options path-email-basic", "Свой сценарий поездки с ограничениями; исходного видео нет."),
        row("5A", "Что изменилось", "g:11 g:12", "v:52", "p:12", "path-past-simple extended-a2-story", "Собственные события и изменения; другой текст."),
        row("5B", "История по порядку", "g:11 g:12 g:24", "v:49", "p:12 p:15", "extended-a2-story path-connectors-basic", "Полный рассказ с причинностью и связками."),
        row("5C", "Извиниться и объяснить", "path-past-simple", "v:52", "p:16", "research-apologies-remedies extended-a2-story", "Готовые извинение, объяснение и ответ с уточнением."),
        row("5D", "Как прошли выходные", "g:85 g:91 g:92", "v:25 v:56", "", "extended-a2-story path-adjectives-frequency", "Собственное описание и рассказ; исходных интервью нет."),
        row("6A", "Кто что делает", "g:3 g:4 path-present-continuous", "v:4 v:5", "p:6", "extended-a2-picture-description path-present-continuous", "Собственная проверенная сцена с 4 людьми и самостоятельным описанием; доступность полного модуля проверяется отдельно."),
        row("6B", "Сравнить дорогу", "g:87 g:88 g:89 path-comparatives", "v:32 v:56", "p:14", "extended-a2-options path-comparatives", "Сравнение вариантов по подготовленным условиям; другой сюжет."),
        row("6C", "Договориться где встретиться", "g:110 path-place-time", "v:29", "p:15 p:16", "extended-a2-relay path-place-time", "Актуальные ориентиры и исправление плана; нет карты и листовки издателя."),
        row("6D", "Движение по городу", "g:110", "v:29 v:30", "", "path-place-time extended-a2-story", "Маршрут и рассказ практикуются отдельно; исходного видео нет.", "partial"),
        row("7A", "Работа и качества", "g:65 g:69 g:71 g:72 path-articles-basic", "v:14 v:56", "p:6", "extended-b1-interview vocabulary-elementary-014", "Есть содержательное интервью, но оно B1, не самостоятельная последовательность A2.", "partial"),
        row("7B", "Обычно и временно", "g:8", "v:46 path-everyday-phrasal", "p:7 p:15", "path-present-continuous extended-a1-day", "Контраст временного и обычного есть; отдельного волонтёрского подкаста и блога A2 нет.", "partial"),
        row("7C", "Получить сведения по телефону", "path-polite-questions", "v:17", "p:16", "extended-a2-phone research-telephone-messages extended-a2-relay", "Готовые звонок, уточнение и передача существенного."),
        row("7D", "Зачем учиться", "g:54 path-gerund-infinitive", "v:15", "", "extended-a2-survey-summary path-gerund-infinitive", "Собственный набор 6 ответов с целями, поздним исправлением и отчётом; доступность полного модуля проверяется отдельно."),
        row("8A", "Что рекомендовать", "g:90 path-comparatives", "v:29 v:30", "p:7 p:15", "extended-a2-options path-comparatives", "Сравнение и рекомендация с причинами; другой исходный форум."),
        row("8B", "Будущая поездка", "g:26 path-future-plans", "v:18 v:32", "p:6 p:15", "extended-a2-options path-future-plans path-connectors-basic", "Согласование плана и объяснение причин на своих материалах."),
        row("8C", "Просьба в гостинице", "g:28 g:34 path-requests-can", "v:21", "p:15", "vocabulary-elementary-021 path-requests-can extended-a2-service", "Есть просьбы, гостиничная лексика и сервисный сценарий; они не объединены в гостиничную запись.", "partial"),
        row("8D", "Как прошла поездка", "g:86", "v:32 v:54", "", "extended-a2-story path-narrative", "Собственный рассказ; исходного видео нет, часть речевых опор B1.", "partial"),
    ]


def b2():
    inputs = APP / "content/crosswalk-inputs"
    grammar = read(inputs / "speakout-b2-grammar-pronunciation.json")
    skills = read(inputs / "speakout-b2-vocabulary-skills.json")
    expected = [f"{number}{letter}" for number in range(1, 9) for letter in "ABCD"]
    for part in (grammar, skills):
        if [entry["code"] for entry in part] != expected:
            raise ValueError("B2 mapping input has missing, reordered or duplicate rows")
    return [dict(code=g["code"], label=s["label"],
                 dimensions=g["dimensions"] + s["dimensions"])
            for g, s in zip(grammar, skills)]


def build():
    metadata = read(APP / "content/crosswalk-inputs/foundation-sources.json")
    b1 = read(APP / "content/crosswalk-inputs/ef-b1-mappings.json")
    if isinstance(b1, dict):
        b1 = b1["rows"]
    specifications = [("ef-a1", "English File 5e A1", "A1", a1()),
                      ("ef-b1", "English File 5e B1", "B1", b1),
                      ("speakout-a2", "Speakout 3e A2", "A2", a2()),
                      ("speakout-b2", "Speakout 3e B2", "B2", b2())]
    if [s["id"] for s in metadata] != [s[0] for s in specifications]:
        raise ValueError("Source metadata must match all four reviewed contents documents")
    sources = []
    for source, (_, title, level, rows) in zip(metadata, specifications):
        sources.append({**source, "title": title, "level": level,
                        "visuallyCheckedPages": list(range(1, source["pages"] + 1)), "rows": rows})
    value = dict(version=1, editorialCheckedAt="2026-09-10", sources=sources,
        scope="Содержательная навигационная сверка публичных оглавлений с авторскими уроками приложения. Полные тексты учебников, упражнения, видео и аудио издателей не воспроизводятся.",
        definitions={
            "mapped": "Есть прямые опоры по названной языковой теме; это не подтверждение совпадения каждого примера и полного Bank издателя.",
            "partial": "Есть только часть темы, более простой/сложный уровень либо не хватает указанного вида работы.",
            "skill-transfer": "Подготовлен сходный вид языковой работы на собственных материалах; исходные сюжет, запись, голос или жанр отличаются.",
            "gap": "Прямая подготовленная работа не найдена.",
            "available": "Файл с содержанием прошёл структурную проверку. Учебные результаты ученика этим не измеряются.",
            "reference-pending": "Теория и задания доступны, но для части свободных ответов ещё не подготовлены образцы.",
            "catalog-only": "Есть тема каталога, но подготовленного файла урока пока нет.",
            "unavailable": "Файл существует, но не прошёл текущую проверку содержания или происхождения."},
        limitations=[
            "A1 PDF показывает грамматику, лексику и произношение; из него нельзя вывести полную программу чтения, слушания и письма.",
            "Проверены только указанные страницы публичных оглавлений; полные закрытые Grammar/Vocabulary Banks не сверены.",
            "Исходные аудио, уличные интервью и видео BBC/Speakout не входят в приложение. Синтез речи не заменяет разнообразие живых голосов.",
            "Метки mapped и skill-transfer не означают завершённость курса издателя или подтверждённый CEFR ученика.",
            "Доступность файлов — отдельная проверка; строки partial сохраняются и после завершения генерации всех книг."],
        targets={})
    out = APP / "content/foundation-book-crosswalk.json"
    out.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({s["id"]: len(s["rows"]) for s in sources}))


if __name__ == "__main__":
    build()

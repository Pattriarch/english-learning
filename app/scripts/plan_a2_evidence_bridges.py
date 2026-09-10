"""Append exactly two original A2 modules after the reviewed 38-module plan."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
from build_extended_course import validate_plan, digest
from publish_book_release import atomic_json

APP = Path(__file__).resolve().parents[1]


SCENE = {
    "datasetId": "courtyard-scene-2026",
    "kind": "reviewed-generated-picture",
    "fictional": True,
    "visuallyCheckedAt": "2026-09-10",
    "imageFile": "courtyard-actions.png",
    "imageSHA256": "4bb3a0674bae1530e79a016264861ca04dd1c66bd74530bcdd36a44419847e4b",
    "facts": [
        "Exactly four adults are visible in a paved courtyard with plants and a brick wall.",
        "On the left, a woman in a yellow jacket is standing and watering flowers in a large pot with a blue watering can.",
        "Near the centre, a man in a blue shirt is sitting on a wooden bench and reading an open book.",
        "To the right of the bench, a woman in a red sweater is standing and holding a white cup in both hands.",
        "At the far right, a man in a green T-shirt is crouching and tying a shoelace.",
        "A bicycle is standing behind the bench near the brick wall.",
        "The picture does not show names, jobs, relationships, nationality, habitual actions or what is inside the cup.",
    ],
    "generation": {
        "tool": "built-in image_gen",
        "prompt": "Use case: photorealistic-natural. Asset type: original English-learning A2 lesson picture for describing visible actions and positions. Create one natural candid photographic scene, landscape 1536x1024, a bright community-centre courtyard in daylight, exactly four adults well separated and entirely visible. At the left, a woman in a yellow jacket is standing and pouring water from a blue watering can onto a large potted plant. In the centre, a man in a blue shirt is sitting on a wooden bench reading an open book. To the right of the bench, a woman in a red sweater is standing holding a white cup with both hands. At the far right, a man in a green T-shirt is crouching and tying a shoelace. An empty bicycle stands against the brick wall behind the bench. Make the hands, objects, clothing colours and spatial relations unambiguous and physically plausible. Eye-level wide framing, softly lit, real textures, no dramatic blur, no ornamental UI. Fictional people, no celebrities. No text, labels, captions, logos or watermark, no extra people. The scene must support literal visual description without suggesting people's names, jobs, relationships or feelings."
    }
}

SURVEY = {
    "fictional": True,
    "scope": "Six fictional club members; one choice each. These are the only responses available.",
    "question": "Which workshop would you like to join, and why?",
    "responses": [
        {"name": "Mina", "choice": "cooking", "reason": "to make simple meals at home"},
        {"name": "Leo", "choice": "photography", "reason": "to take better pictures of his dog"},
        {"name": "Sara", "choice": "cooking", "reason": "to cook for her friends"},
        {"name": "Ben", "choice": "bike repair", "reason": "to fix his old bicycle"},
        {"name": "Eva", "choice": "photography", "reason": "to use her new camera"},
        {"name": "Omar", "choice": "cooking", "reason": "to learn a few easy recipes"},
    ],
    "correction": {"name": "Omar", "newChoice": "photography", "newReason": "to take family pictures", "replacesPreviousResponse": True},
    "initialCounts": {"cooking": 3, "photography": 2, "bike repair": 1},
    "finalCounts": {"cooking": 2, "photography": 3, "bike repair": 1},
    "unknown": ["workshop date", "price", "choices of other members", "whether anyone will actually attend"],
}


def material(identifier, kind, minimum, maximum, brief, **extra):
    return dict(id=identifier, kind=kind, minWords=minimum, maxWords=maximum, brief=brief, **extra)


def exercise(kind, materials, brief, minimum=0):
    result = dict(kind=kind, materialIds=materials.split(), brief=brief)
    if minimum:
        result["minAnswerWords"] = minimum
    return result


def modules():
    common = [
        "Все английские тексты, задания и ответы полностью авторские; не воспроизводить материалы Speakout и не приписывать сцену/ответы реальным людям.",
        "Теория учит переносу на других примерах и не раскрывает целевые ответы до задания. Не обсуждать JSON, генераторы и внутреннее устройство приложения в учебных объяснениях.",
        "Ровно8 заданий самостоятельного полного ответа, без выбора, пропусков и перестановки. 1–3 законченных допустимых образца и не менее55 русских слов содержательного объяснения у каждого. Проверять все части объёма; не добивать объём повтором.",
        "Простые естественные фразы A2; допускаются альтернативные точные формулировки. Устная задача — самостоятельная сценарная репетиция, не настоящий разговор с человеком и не акустическая оценка.",
        "Новые сведения появляются только на запланированном этапе. Не требовать отсутствующий прошлый ответ ученика. Все обязательные задания выполнимы сразу по материалам.",
    ]
    picture = dict(id="extended-a2-picture-description", title="Четыре человека во дворе: описать и помочь найти", level="A2",
        skills=["reading", "listening", "writing", "speaking", "mediation", "vocabulary"],
        outcomes=["Описать наблюдаемые действия, одежду и расположение людей по конкретному изображению.",
                  "Отделить видимое от догадки о привычках, отношениях и содержимом предмета.",
                  "По новому запросу дать человеку без изображения точное краткое описание нужного человека."],
        visualDataSpec=SCENE,
        materials=[
            material("m1", "reference", 100, 150, "Полное доступное английское описание только визуально проверенных фактов SCENE. Видимые детали и границы знания, без вымышленных имён/профессий. Этот текст можно открыть вместо изображения; по умолчанию он скрыт, изображение видно.",
                figure=dict(id="courtyard-actions", format="png", alt="Four adults doing different things in a courtyard. A text description is available below the picture.", caption="Авторская учебная сцена, созданная с помощью ИИ. Люди и ситуация вымышлены.")),
            material("m2", "listening", 65, 90, "Новое полное вымышленное голосовое сообщение посетителя после e4. Ему нужно вернуть книгу человеку в синей рубашке; он просит объяснить, где тот находится и что делает. Посетитель не видит изображение, имени человека не знает. Никаких новых визуальных фактов, заявлений о работе/родстве; это отдельное условие сценария, не то, что видно на фото."),
            material("m3", "reading", 55, 80, "Новый конкретный запрос после e7: тот же посетитель теперь ищет свой белый стакан/чашку. Просит описать человека, у которого белая чашка, и уточнить, можно ли по изображению понять, что в чашке. Нельзя объявлять напиток или имя известным. Готовая полная английская записка; не требовать прежний ответ ученика."),
        ],
        exercisePlan=[
            exercise("write", "m1", "Написать4 полных английских предложения по изображению, по одному о каждом человеке: опознавательный признак и видимое действие. Не давать слова решения в подсказке."),
            exercise("translate", "m1", "Дать полный русский запрос другу о мужчине на скамейке и велосипеде позади него; перевести целое сообщение. Исходная русская мысль должна содержать вопрос и утверждение, соответствующие изображению."),
            exercise("speak", "m1", "Самостоятельное описание50–70 английских слов, приблизительно30–45секунд: провести слушателя слева направо по сцене. Назвать все4 действия, два признака одежды, один ориентир. Полный образец нужного объёма.", 50),
            exercise("rewrite", "m1", "Дать полный ошибочный английский черновик с3 проверяемыми визуальными ошибками и2 необоснованными выводами (например, профессия/привычка/напиток). Переписать в55–75слов как точную подпись без догадок. Полный образец, отдельное русское объяснение каждой правки.", 55),
            exercise("write", "m1 m2", "Прослушать новый запрос посетителя и ответить ему40–60английскими словами: указать нужного человека, одежду, положение и действие; имя не придумывать. Не пересказывать весь двор.", 40),
            exercise("write", "m1 m2", "Написать независимую подпись70–90английских слов для человека, который не видит изображения. Описать обстановку, все4 действия, велосипед и1 явную границу знания. Не переносить обстоятельство о возвращении книги из голоса в якобы видимый факт.", 70),
            exercise("speak", "m1 m2", "Полная устная репетиция50–70английских слов: объяснить посетителю путь внимания к человеку с книгой и ответить на прямо приведённый вопрос посетителя о его имени. Дать информативный ответ и честно назвать неизвестное.", 50),
            exercise("write", "m1 m3", "После нового сообщения написать45–65английских слов для поиска чашки: другой человек, точная одежда/положение, наблюдаемое действие, предел знания о напитке. Самодостаточная смена цели без ссылок на отсутствующий ответ ученика.", 45),
        ], sourceIds=["speakout-a2", "cefr-2020"], relatedLessonIds=["path-present-continuous", "path-place-time", "path-possession"],
        externalCrosswalkBlocks=["speakout-a2/6A"], authoringRules=common + ["Изображение уже создано и визуально проверено. Не менять факты visualDataSpec. В частности, чашка находится в руках, питьё не показано; имена, работа и отношения неизвестны. Нельзя выдавать синтетическую сцену за настоящую фотографию события."])
    survey = dict(id="extended-a2-survey-summary", title="Шесть ответов: провести опрос и обновить итоги", level="A2",
        skills=["reading", "listening", "writing", "speaking", "interaction", "mediation"],
        outcomes=["Составить понятный вопрос о выборе занятия и цели участия.",
                  "Посчитать и кратко передать результаты заданной группы, сохранив причины отдельных ответов.",
                  "Обновить итог после исправления одного ответа и назвать неизвестные условия."],
        surveyDataSpec=SURVEY,
        materials=[
            material("m1", "listening", 70, 95, "Полная голосовая просьба вымышленного организатора клуба: выбрать одно из3 занятий (cooking, photography, bike repair), спросить зачем, собрать6 ответов. Дата и цена ещё неизвестны; не обещать посещаемость. Числа распределения пока не раскрывать."),
            material("m2", "reading", 130, 180, "Шесть полных коротких ответов по surveyDataSpec.responses: ровно1 выбор и указанная причина каждого. Можно добавить простые нейтральные связующие фразы, но не новые предпочтения, количества, сроки или условия. Не давать готовую итоговую таблицу, ученик считает сам. Всё явно вымышленно."),
            material("m3", "listening", 60, 85, "Полное исправление Омара: заменить его прежний ответ на photography для семейных снимков. Это тот же человек и замена, не7-й голос. Не добавлять финальные итоги; дать естественное сообщение, которое нужно понять и применить."),
        ],
        exercisePlan=[
            exercise("write", "m1", "После прослушивания написать35–50слов организатору: что собираетесь спросить, у скольких людей, какие2условия пока неизвестны. Не запрашивать цифры, которых ещё нет.", 35),
            exercise("speak", "m1", "Составить и произнести полный короткий сценарий опроса35–50слов: вступление, вопрос о выборе одного занятия, вопрос о цели, благодарность. Самостоятельная репетиция, не утверждать будто живые люди ответили.", 35),
            exercise("write", "m1 m2", "По6ответам составить40–60слов первоначального итога: количество для каждого занятия и2верно привязанные причины. Общее число6. Не называть3из6 большинством и не расширять вывод на весь клуб.", 40),
            exercise("translate", "m1 m2", "Дать полное русское сообщение с точными исходными количествами3/2/1, одним примером цели и неизвестной ценой. Перевести целую мысль, передав learn to/use to без кальки. Не раскрывать новое исправление."),
            exercise("write", "m1 m2 m3", "Прослушать исправление и написать45–65слов: чей ответ заменён, новые количества, общее число и изменившаяся цель. Не прибавлять7-го человека.", 45),
            exercise("write", "m1 m2 m3", "Самостоятельный итоговый email70–90английских слов организатору: размер группы, все актуальные количества, две причины с верной принадлежностью, осторожное предложение и вопрос о дате/цене. Только эти6ответов, не весь клуб.", 70),
            exercise("speak", "m1 m2 m3", "Устный итог50–70английских слов для отсутствовавшего друга, приблизительно30–45секунд. Объяснить один изменённый выбор и окончательные результаты, предложить уточнить одно неизвестное условие.", 50),
            exercise("rewrite", "m1 m2 m3", "Дать полный ошибочный английский итог с добавленным7-м участником, старым числом cooking, перепутанной целью одного человека, придуманной ценой и распространением вывода на всех. Переписать в65–85слов с точными итогами и пределом знания. Не требовать собственную прежнюю работу ученика.", 65),
        ], sourceIds=["speakout-a2", "cefr-2020"], relatedLessonIds=["path-gerund-infinitive", "path-quantifiers-nuance", "extended-a2-relay"],
        externalCrosswalkBlocks=["speakout-a2/7D"], authoringRules=common + ["Строго сохранять surveyDataSpec. 3из6 — половина, не большинство; biggest group допустимо, only most не употреблять для половины. Цель Омара после исправления относится к семейным фото. До e5 исправление не раскрывать; после e5 использовать2/3/1. Не приписывать сведения реальному клубу или исследованию."])
    return [picture, survey]


def publish_plan():
    plan_path = APP / "content/extended-course-plan.json"
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    additions = modules()
    existing = {m["id"]: m for m in plan["modules"]}
    original = [m for m in plan["modules"] if m["id"] not in {x["id"] for x in additions}]
    if len(original) != 38:
        raise ValueError("Expected the preceding 38-module plan")
    for module in additions:
        if module["id"] in existing and existing[module["id"]] != module:
            raise ValueError("Refusing to replace an edited bridge module")
        if module["id"] not in existing:
            plan["modules"].append(module)
    plan["foundationBridges"] = dict(editorialCheckedAt="2026-09-10", prior38ObjectSHA256=digest(original), moduleIds=[m["id"] for m in additions])
    validate_plan(plan)
    folder = APP / "studio/assets/learning-figures"
    image = folder / SCENE["imageFile"]
    if hashlib.sha256(image.read_bytes()).hexdigest() != SCENE["imageSHA256"]:
        raise ValueError("Reviewed scene image changed")
    dataset = folder / "courtyard-scene.json"
    atomic_json(dataset, SCENE)
    manifest_path = folder / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entry = dict(id="courtyard-actions", materialId="m1", file=image.name, sha256=SCENE["imageSHA256"],
                 datasetFile=dataset.name, datasetSHA256=hashlib.sha256(dataset.read_bytes()).hexdigest())
    previous = next((e for e in manifest["figures"] if e["id"] == entry["id"]), None)
    if previous and previous != entry:
        raise ValueError("Refusing to overwrite a different published scene")
    if not previous:
        manifest["figures"].append(entry)
    atomic_json(manifest_path, manifest)
    atomic_json(plan_path, plan)
    print(json.dumps({"modules": len(plan["modules"]), "added": [m["id"] for m in additions], "prior38ObjectSHA256": digest(original)}))


if __name__ == "__main__":
    publish_plan()

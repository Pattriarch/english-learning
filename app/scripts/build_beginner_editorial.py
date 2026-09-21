"""Publish hand-written beginner edits against exact, unchanged book releases.

This contains authored teaching, not model generation or mechanical paraphrases.
Running it only writes the explicitly listed book-editorial JSON files.
"""
import hashlib
import json
from pathlib import Path

CONTENT = Path(__file__).resolve().parents[1] / "content"


def task(prompt, answer, why, *, model=None, ru=None, body=None, kind="translate", context="", hint=""):
    result = dict(kind=kind, prompt=prompt, context=context,
                  answers=[answer], hint=hint or why, explanation=why)
    if model:
        result.update(practiceStage="guided", guidance=dict(title="Сначала на примере", body=body or why, example=model, translation=ru))
    else:
        result["practiceStage"] = "independent"
    return result


EDITS = {
    1: dict(
        title="Я готов. Она устала. Как сказать это по-английски",
        goal="Сказать, кто ты, как себя чувствуешь и где находишься. Сначала одна короткая фраза, затем две связанные мысли.",
        formula="I am ready. — Я готов. She is ready. — Она готова. We are ready. — Мы готовы.",
        sections=[
            "Ты собрался выходить и говоришь: «Я готов». По-английски: I am ready. I — «я», ready — «готов». Между ними нужно am. Отдельного русского слова для am здесь нет.\n\nМеняется человек — меняется маленькое слово: I am; he/she/it is; you/we/they are. He — он, she — она, it — это/он/она о вещи; you — ты или вы, we — мы, they — они. С именем: Alex is ready — Алекс готов.\n\nReady не меняется: She is ready — она готова; They are ready — они готовы. Не пытайся добавить английскому прилагательному русское окончание.",
            "Представиться можно совсем коротко: I am Alex — Я Алекс. Ещё вариант: My name is Alex — Меня зовут Алекс. My name значит «моё имя», поэтому после name стоит is.\n\nВозраст: I am twenty — Мне двадцать. Twenty — двадцать; years old можно добавить, но не обязательно: I am twenty years old. В английском здесь am, хотя по-русски говорим «мне».\n\nПрофессия: I am a teacher — Я учитель. Teacher — учитель; a перед профессией одного человека означает «один представитель такой профессии». Перед начальным гласным звуком берём an: an engineer — инженер. Пока удобно запомнить a teacher и an engineer целиком. I am from Boston — Я из Бостона; from — из.",
            "Вернулся после долгого дня? I am tired — Я устал. Собрался вовремя? I am ready — Я готов. Вот ещё две полезные фразы: I am hungry — Я голоден; I am thirsty — Я хочу пить. Hungry — голодный, thirsty — испытывающий жажду.\n\nО другом человеке: She is tired — Она устала. О нескольких: We are hungry — Мы голодны. По-русски «устал» звучит как действие, но здесь английское tired описывает состояние.\n\nИнтересы можно назвать готовым сочетанием: I am interested in music — Мне интересна музыка. Interested in — «интересующийся чем-то». Не путай с interesting — «интересный»: это уже описание того, что вызывает интерес.",
            "Нужно сказать, что описание не подходит? Добавь not сразу после am/is/are: I am not tired — Я не устал. She is not ready — Она не готова. We are not at home — Мы не дома.\n\nВ переписке и речи формы часто сокращают: I am → I’m; she is → she’s; we are → we’re. Это те же фразы, просто короче. Апостроф заменяет пропущенные буквы.\n\nС отрицанием: I’m not ready; she isn’t ready; we aren’t ready. She’s not и we’re not тоже правильны. Сейчас можно писать полные формы: важнее собрать мысль, чем помнить все сокращения сразу.",
            "Где ты? I am at home — Я дома. At home учим как готовое «дома». Ещё: at work — на работе; in my bag — в моей сумке. My phone is in my bag — Мой телефон в моей сумке. Phone — телефон.\n\nО погоде говорим с it: It is cold — Холодно; It is sunny — Солнечно. Cold — холодный, sunny — солнечный. По-русски слово «это» не нужно, но английское it оставляем.\n\nСо временем похоже: It is five — Сейчас пять часов. Five — пять. You are late — Ты опоздал: late описывает твоё положение сейчас, а не строит рассказ о прошлом.",
            "Эти короткие фразы пригодятся, когда что-то показываешь. Here is your bag — Вот твоя сумка: предмет рядом, ты показываешь или передаёшь его. Here’s — сокращение here is.\n\nThere is Alex — Вон Алекс: привлекаешь внимание к человеку. There’s a café nearby — Рядом есть кафе: сообщаешь, что оно есть. Nearby — рядом. Позже этому «есть» будет отдельная тема.\n\nThat is nice — Это приятно / здорово: реагируешь на понятную собеседнику вещь или новость. That’s — сокращение that is. Не нужно учить три определения: представь, что ты передаёшь сумку, замечаешь Алекса или радуешься новости.",
        ],
        examples=[
            ("I am ready.", "Я готов.", "I — я, ready — готов. Между ними нужно am."),
            ("She is tired.", "Она устала.", "После she выбираем is. Tired описывает состояние."),
            ("We are at home.", "Мы дома.", "После we — are; at home — готовое сочетание «дома»."),
            ("I am not hungry.", "Я не голоден.", "Not после am делает мысль отрицательной."),
            ("Here is your bag.", "Вот твоя сумка.", "Так можно сказать, передавая сумку собеседнику."),
        ],
        exercises=[
            task("Напиши: «Я готов». Ready — готов.", "I am ready.", "Между I и ready нужно am.", model="I am tired.", ru="Я устал.", body="I — я. Tired — устал. Чтобы описать себя, собираем I am + состояние. Для «готов» поменяй только последнее слово."),
            task("Напиши: «Она устала». She — она, tired — устала.", "She is tired.", "После she выбираем is, а не am.", model="She is ready.", ru="Она готова.", body="С she используется is. Ready — готова; tired — устала. Схема та же, меняем состояние."),
            task("Напиши: «Мы дома». We — мы, at home — дома.", "We are at home.", "После we ставим are. At home не меняется.", model="We are ready.", ru="Мы готовы.", body="Мы — несколько людей: we are. Вместо состояния после are можно назвать место."),
            task("Измени I am ready так, чтобы получилось «Я не готов».", "I am not ready.", "Not ставим после am.", kind="rewrite", model="I am not tired.", ru="Я не устал.", body="Чтобы сказать «не», добавляем not после am. Остальные слова остаются на своих местах."),
            task("Измени She is ready: теперь готовы они. They — они.", "They are ready.", "С they используем are. Слово ready не меняется.", kind="rewrite", model="She is tired. They are tired.", ru="Она устала. Они устали.", body="Меняем человека и связку: she is → they are. Описание состояния остаётся тем же."),
            task("Как ты себя сейчас чувствуешь? Напиши одну фразу. Можно взять ready — готов, tired — устал или hungry — голоден.", "I am tired.", "Это образец, а не единственное состояние: выбери то, что подходит тебе. Начни с I am.", kind="write"),
            task("Представь открытую дверь. Напиши: «Дверь открыта». The door — дверь, open — открыта.", "The door is open.", "Дверь — один предмет, поэтому is. The door уже дано целиком: артикль сейчас не нужно угадывать.", kind="write"),
            task("Представься и скажи, готов ли ты: две короткие фразы. Можно использовать I am + имя и I am ready / I am not ready. Произнеси или надиктуй их.", "I am Alex. I am ready.", "Имя может быть твоим или вымышленным. Обе мысли уже знакомы: кто я и какое у меня состояние.", kind="speak"),
        ],
    ),
    2: dict(
        title="Ты готов? Где ты? Собираем первые вопросы",
        goal="Задать один простой вопрос с am/is/are и ответить на него. Узнать место, возраст или цвет, не сочиняя длинный диалог.",
        formula="You are ready. → Are you ready? — Ты готов? Where are you? — Где ты?",
        sections=[
            "Ты говоришь другу: You are ready — Ты готов. А если не уверен и хочешь спросить? Переставь are вперёд: Are you ready? — Ты готов? Вопросительный знак в конце показывает вопрос на письме.\n\nShe is at home → Is she at home? — Она дома? I am late → Am I late? — Я опоздал? Late — опоздавший. Меняется порядок, а не сами формы.\n\nНе добавляй do: в этих фразах уже есть am/is/are, и для вопроса мы просто ставим это слово перед человеком.",
            "В вопросе после is или are называется тот, о ком ты спрашиваешь. Is Alex ready? — Алекс готов? Is the door open? — Дверь открыта? The door — дверь, open — открыта.\n\nПро несколько предметов: Are the bags heavy? — Сумки тяжёлые? The bags — сумки, heavy — тяжёлые. Имена и названия не мешают схеме: is/are + кто или что + описание.\n\nС you всегда are: Are you tired? одинаково подходит одному человеку на «ты» и нескольким на «вы».",
            "Вопрос Are you at home? ждёт «да» или «нет». Where are you? просит назвать место: where — где. I am at home — Я дома.\n\nWhat is this? — Что это? What — что, this — это. Who is that? — Кто это? Who — кто; that указывает на человека, которого вы видите или обсуждаете.\n\nWhy are you late? — Почему ты опоздал? Why — почему. Сначала реши, какую деталь хочешь узнать, затем выбери where, what, who или why. После этого слова сохраняется знакомый порядок are you / is she.",
            "How are you? — Как ты? Это вопрос о самочувствии или делах. Ответ может быть I am fine — У меня всё хорошо. Fine — в порядке.\n\nHow old are you? — Сколько тебе лет? How old учим целиком как вопрос о возрасте. What color is it? — Какого это цвета? Color — цвет, американское написание.\n\nHow much is it? — Сколько это стоит? What time is it? — Который час? Не собирай эти вопросы по русским словам: возьми целую рамку и потренируй одну за раз.",
            "Where is можно сократить до Where’s: Where’s Alex? — Где Алекс? What’s this? означает What is this? — Что это? Полные формы тоже правильны.\n\nНа Are you ready? можно ответить Yes, I am — Да. Ты отвечаешь о себе, поэтому I. В таком коротком «да» am остаётся полным: не Yes, I’m.\n\nПро другого человека: Is she ready? — Yes, she is. Про нескольких: Are they ready? — Yes, they are. Повторяем человека и подходящую форму.",
            "Если ответ «нет», добавь not: No, I am not. Чаще говорят No, I’m not. Is she ready? — No, she isn’t. Are they ready? — No, they aren’t.\n\nНе копируй местоимение из вопроса бездумно. Тебя спросили Are you tired? — «Ты устал?». Ты отвечаешь No, I’m not — «Нет, я не устал».\n\nКороткий ответ — уже полноценный ответ. Если хочется, добавь одну деталь: No, I’m not. I’m ready — Нет, не устал. Я готов.",
        ],
        examples=[
            ("Are you ready?", "Ты готов?", "Are переместилось перед you: теперь мы спрашиваем."),
            ("Where is Alex?", "Где Алекс?", "Where просит назвать место; после него is, затем имя."),
            ("Is the door open?", "Дверь открыта?", "The door — один предмет, поэтому is."),
            ("Are you tired? No, I’m not.", "Ты устал? Нет.", "Собеседник говорит you; отвечая о себе, я использую I."),
        ],
        exercises=[
            task("Спроси: «Ты готов?» Ready — готов.", "Are you ready?", "В вопросе are стоит перед you.", model="Are you tired?", ru="Ты устал?", body="В утверждении You are tired. В вопросе Are you tired? Поменяли местами только you и are."),
            task("Спроси: «Алекс дома?» At home — дома.", "Is Alex at home?", "С одним человеком Alex нужна форма is перед именем.", model="Is Alex ready?", ru="Алекс готов?", body="Is + имя + описание или место. Чтобы спросить о месте, замени ready на at home."),
            task("Спроси: «Где ты?» Where — где.", "Where are you?", "Сначала where, затем are you.", model="Where is Alex?", ru="Где Алекс?", body="Where просит назвать место. После него — знакомый порядок вопроса: is Alex или are you."),
            task("Преврати The door is open в вопрос. The door — дверь, open — открыта.", "Is the door open?", "Is переносим перед the door.", kind="rewrite", model="Alex is ready. Is Alex ready?", ru="Алекс готов. Алекс готов?", body="Для вопроса ставим is перед тем, о ком спрашиваем. Вся группа the door остаётся вместе."),
            task("Тебя спрашивают Are you ready? Ответь коротко: «Да».", "Yes, I am.", "Говорим о себе: I. В коротком положительном ответе am не сокращаем.", model="Are you tired? Yes, I am.", ru="Ты устал? Да.", body="В вопросе you — ты. В своём ответе I — я. Yes, I am — готовая рамка такого ответа."),
            task("Хочешь узнать возраст собеседника. Напиши один вопрос. Используй How old — сколько лет.", "How old are you?", "После How old сохраняется are you. Отвечать за собеседника не нужно.", kind="write"),
            task("Тебя спрашивают Is Alex at home? Алекс сейчас не дома. Напиши короткий ответ с he — он.", "No, he isn't.", "No, he is not тоже правильно. Здесь отрицательный ответ, поэтому нужен not или isn’t.", kind="write"),
            task("Произнеси мини-диалог из двух реплик: спроси «Ты готов?» и ответь за себя «Да» или «Нет». Никаких других реплик не нужно.", "Are you ready? Yes, I am.", "Можно ответить No, I’m not. Мы тренируем сам вопрос и смену you → I.", kind="speak"),
        ],
    ),
}

# These short additions preserve the less central source points without making
# them prerequisites for the first eight small practice steps.
EXTRA_EXPLANATIONS = {
    1: [
        "Один предмет: The bag is heavy — Сумка тяжёлая. Несколько: The bags are heavy — Сумки тяжёлые. The bag / the bags здесь уже даны целиком. Alex and I are ready — Мы с Алексом готовы: and I значит «и я», вместе нас двое, поэтому are.",
        "I am American — Я американец/американка: здесь American описывает национальность, поэтому a/an не нужно. I am an American тоже правильно: an American здесь называет человека. А I am a good swimmer — Я хорошо плаваю: a good swimmer значит «хороший пловец», один человек. Любимый цвет: My favorite color is blue — Мой любимый цвет синий. Несколько цветов: My favorite colors are blue and green — Мои любимые цвета синий и зелёный. Favorite — любимый, color — цвет, green — зелёный.",
        "Представь шесть маленьких сцен: хочется пить — I’m thirsty; мёрзнешь — I’m cold; жарко — I’m hot; страшно — I’m scared; хочется есть — I’m hungry; злишься — I’m angry. I’m = I am. Cold и hot про человека означают ощущение; The cup is hot — Чашка горячая описывает сам предмет. I’m sick — Я болею; ill значит то же, но в обычном американском разговоре часто выбирают sick.\n\nI’m scared of dogs — Я боюсь собак: scared of — боюсь чего-то, dogs — собаки. I’m not interested in music — Музыка меня не интересует: not добавляет «не».\n\nТак же описываем свойства: heavy — тяжёлый; beautiful — красивый; comfortable — удобный; rich — богатый; cheap — дешёвый. The chair is comfortable — Стул удобный. The chairs are comfortable — Стулья удобные. Chair — стул; прилагательное comfortable в обеих фразах одинаковое.",
        "Остальные сокращения: he is → he’s; it is → it’s; you are → you’re; they are → they’re. Исправить факт можно двумя частями: I’m not tired, but I’m hungry — Я не устал, но я голоден. But — но; оно связывает две уже знакомые мысли.",
        "Ещё места: at school — в школе; in bed — в постели. Ещё погода: warm — тепло; hot — жарко; windy — ветрено. Можно сказать The weather is cold — Погода холодная: weather — погода, с ним is. You are early — Ты пришёл рано; early противоположно late.",
        "Человек помог тебе: That’s kind of you — Это очень мило с твоей стороны. Kind здесь — добрый/внимательный. Эту благодарность удобно запомнить целиком.",
    ],
    2: [
        "Am используется с I, is — с he/she/it, are — с you/we/they: те же пары, что в утверждении. Is she a teacher? — Она учитель? Вопрос устроен так же, хотя теперь уточняем профессию.",
        "Не разрывай название предмета: Is the door open?, а не Is open the door? Если предмет уже назван: Is it open? — Она открыта? Про несколько сумок: Are they heavy? — Они тяжёлые? It заменяет один предмет, they — несколько.\n\nAre you married? — Ты женат/замужем? Married — состоящий в браке. Is the book interesting? — Книга интересная? Are you interested in books? — Тебе интересны книги? Interesting описывает книгу, interested in — интерес человека; book — книга.",
        "Where are you? — Где ты сейчас? Where are you from? — Откуда ты родом? From меняет смысл вопроса. What is your name? — Как тебя зовут? What is your favorite sport? — Какой твой любимый вид спорта? Favorite — любимый, sport — спорт. Можно отвечать коротко: Alex; from Boston; tennis. На вопрос «где?» достаточно места, а не ответа Yes.",
        "Про несколько вещей: How much are the tickets? — Сколько стоят билеты? Tickets — билеты, поэтому are. Five dollars each — По пять долларов: each — каждый, цена за один билет. Не путай её с ценой всей покупки.",
        "Ещё два сокращения: Who’s that? = Who is that? — Кто это? How’s Alex? = How is Alex? — Как Алекс? В вопросе сократить is можно; в коротком Yes, he is конечное is оставляем полным.",
        "No, she is not; No, she’s not; No, she isn’t — три правильных формы. С they: No, they are not / they’re not / they aren’t. Про погоду: Is it cold? — No, it isn’t. But it’s windy — Холодно? Нет. Но ветрено. But — но.\n\nКороткое отрицание пригодится и для возражения. Кто-то говорит: This seat is free — Это место свободно. Ты знаешь, что оно занято: No, it isn’t. It’s taken — Нет. Оно занято. Seat — место для сидения, free — свободное, taken — занятое.",
    ],
}
for number, additions in EXTRA_EXPLANATIONS.items():
    EDITS[number]["sections"] = [body + "\n\n" + extra for body, extra in zip(EDITS[number]["sections"], additions)]


def publish():
    output = CONTENT / "book-editorial"
    output.mkdir(exist_ok=True)
    for number, authored in EDITS.items():
        unit_id = f"grammar-elementary-{number:03}"
        raw = (CONTENT / "book-lessons" / f"{unit_id}.json").read_bytes()
        base = json.loads(raw)
        assert len(authored["sections"]) == len(base["sections"])
        assert len(authored["exercises"]) == len(base["exercises"])
        result = dict(version=1, unitId=unit_id, baseLessonSHA256=hashlib.sha256(raw).hexdigest(),
                      reviewedAt="2026-09-21", notes="Пошаговая редакция для самостоятельного изучения: короткие объяснения, американские образцы и опора до нового действия.",
                      title=authored["title"], goal=authored["goal"], formula=authored["formula"], minutes=25, beginner=True)
        result["sections"] = [dict(title=old["title"], body=body) for old, body in zip(base["sections"], authored["sections"])]
        result["examples"] = [dict(en=en, ru=ru, why=why) for en, ru, why in authored["examples"]]
        result["exercises"] = [dict(task, id=old["id"], revision=old.get("revision", 0)+1) for old, task in zip(base["exercises"], authored["exercises"])]
        (output / f"{unit_id}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
        print(unit_id, "sections", len(result["sections"]), "exercises", len(result["exercises"]))


if __name__ == "__main__":
    publish()

"""Reviewed, field-specific US pronunciation migration; no generic IPA substitution.

The original snapshot is backed up before application. A receipt records every
changed field and each lesson hash. Re-running is a no-op only for the exact
published result; a different input is rejected rather than overwritten.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

APP = Path(__file__).resolve().parents[1]
BEFORE_SHA = '2169ea83711796186092f64edd0c7a3ba7b87945cff3b512be4da06ddbcf7a23'
VERSION = 'us-pronunciation-2026-09-10-v1'
GUIDE = 'https://www.oxfordlearnersdictionaries.com/about/pronunciation_english.html'
FLAP = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2390816/'
MERGER = 'https://www.cambridge.org/core/journals/language-variation-and-change/article/abs/solving-the-actuation-problem-merger-and-immigration-in-eastern-pennsylvania/3A4A39FD146C559E7E0819FFEC9FCBA5'


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def sha(value):
    return hashlib.sha256(value).hexdigest()


def migrate(original):
    data = copy.deepcopy(original)
    lessons = data['lessons']
    assert len(lessons) == 16
    def lesson(n):
        value = lessons[n-1]
        assert value['id'].startswith(f'pron-{n:02d}-')
        return value
    def theory(n, index, title, body):
        lesson(n)['explanation'][index] = {'title': title, 'body': body}
    def field(n, path, value):
        target = lesson(n)
        for part in path[:-1]:
            target = target[part]
        target[path[-1]] = value
    def replace(n, path, before, after):
        target = lesson(n)
        for part in path:
            target = target[part]
        assert before in target, (n, path, before)
        field(n, path, target.replace(before, after))
    def word(n, text, ipa):
        found = [e for s in lesson(n)['sounds'] for e in s['examples'] if e['word'] == text]
        assert len(found) == 1, (n, text)
        found[0]['ipa'] = ipa

    data['description'] = '16 практических уроков: от букв и транскрипции до связной речи, интонации и чтения вслух. Основная опора — американский английский с произносимым r, русскими объяснениями и собственными английскими ответами. Британские сравнения отмечены отдельно. Региональные варианты допустимы: цель — понятная речь, а не единственный «правильный» акцент.'
    theory(1, 2, 'Названия букв и американская опора', 'Названия A /eɪ/, E /iː/, I /aɪ/, O /oʊ/, U /juː/ нужны, когда диктуешь имя; внутри слова эти буквы могут звучать иначе. В американском алфавите Z обычно /ziː/, в британском — /zed/. Для сравнения: британское название O записывают /əʊ/. Начни с американских записей US и последовательно сравнивай с ними свои слова. Это выбранная опора курса, а не запрет на другие понятные варианты. Сочетание sh в shop обозначает один согласный /ʃ/, а не два звука по числу букв.')
    word(1, 'shop', '/ʃɑːp/')
    replace(1, ['practice','reference'], 'your surname', 'your last name')
    theory(2, 2, 'Американская IPA и явные сравнения', 'Основная запись здесь американская: home /hoʊm/, car /kɑːr/. R сохраняется и перед паузой, и перед согласным. Британские /həʊm/ и /kɑː/ приведены для сравнения; это другая модель, а не ошибки. В разных словарях сходное звучание записывают немного по-разному: /e/ или /ɛ/ для bed, /ɜːr/ или /ɝː/ для ударного гласного с r, /ər/ или /ɚ/ для безударного. В курсе используем /e/, /ɜːr/, /ər/; не превращай два знака в обязательные два слога. IPA — широкая опора, не точная запись каждого движения. Выбирай US-аудио и слушай целое слово, ударение и фразу.')
    word(2, 'understand', '/ˌʌndərˈstænd/')
    word(2, 'information', '/ˌɪnfərˈmeɪʃən/')
    replace(2, ['practice','prompt'], '/ˌɪnfəˈmeɪʃən/', '/ˌɪnfərˈmeɪʃən/')
    # Lesson 03 contrasts are shared across the two broad models; no false new rule.
    theory(4, 1, 'Cut, cart, cot — и почему bath отдельно', 'В американской опоре cut /kʌt/, cart /kɑːrt/ и cot /kɑːt/. У cart важно сохранить r: это не просто удлинённое cut. Cot, hot и palm относятся здесь к /ɑː/; британское /ɒ/ в cot не является нашей основной целью. Bath в американском словаре /bæθ/, как по типу гласного bad, а британский южный ориентир — /bɑːθ/. Нельзя менять любое написанное a на один звук: проверяй слово. Для cot /kɑːt/ и caught /kɔːt/ показана словарная модель без слияния. У многих американцев эти гласные совпадают; другие сохраняют различие. Оба варианта допустимы, поэтому одинаковое звучание этой пары само по себе не ошибка.')
    theory(4, 2, 'Bird: гласный с r', 'В американской модели bird /bɜːrd/, work /wɜːrk/ и learn /lɜːrn/ сохраняют r-окраску гласного. Не делай русский раскатистый р и не вставляй отдельный гласный перед ним. Положение языка может различаться: важен узнаваемый результат без вибрации кончика. Запись /ɜːr/ в другом словаре может выглядеть как /ɝː/: это не указание добавить слог. Для сравнения, в неротической британской модели bird /bɜːd/ не содержит произносимого r перед d. Сначала слушай американский образец, затем сравни британский; не пытайся одновременно выполнить обе схемы одним словом.')
    for w,p in {'cart':'/kɑːrt/','heart':'/hɑːrt/','cot':'/kɑːt/','hot':'/hɑːt/','bird':'/bɜːrd/','work':'/wɜːrk/'}.items(): word(4,w,p)
    for index,ipa,label,art in [(3,'/ɑːr/','cart, heart: гласный с r','Открой рот для гласного и сохрани r-окраску. Не добавляй отдельный слог и не раскатывай r.'),(4,'/ɑː/','cot, hot: американская опора','Открытый гласный без обязательного округления губ; не копируй британский /ɒ/ как единственный вариант.'),(5,'/ɔː/','caught, law: вариант без слияния','В показанной словарной модели гласный отличается от cot. При cot–caught merger он может совпадать с /ɑː/; это допустимо.'),(6,'/ɜːr/','bird, work: r-окрашенный гласный','Сохрани r-окраску внутри слога без русского раскатистого р; не произноси британский вариант без r по привычке.')]:
        for key,value in [('ipa',ipa),('label',label),('articulation',art)]: field(4,['sounds',index,key],value)
    field(4,['examples',1,'note'],'В американском cut /kʌt/ и cart /kɑːrt/ различаются гласный и наличие r.')
    field(4,['examples',2,'note'],'В bird сохраняется r-окраска. Caught и hot могут иметь разные или совпадающие гласные в зависимости от американского акцента.')
    field(4,['contrastPairs',1,'right'],'cart /kɑːrt/')
    field(4,['contrastPairs',1,'note'],'В американской опоре меняется гласный и сохраняется r в cart.')
    field(4,['contrastPairs',2,'left'],'cot /kɑːt/')
    replace(4,['practice','reference'],'In the British model used here, bird has /ɜː/ without a separate /r/; many American accents use an r-coloured vowel.','In the American model used here, bird has an r-colored vowel, written /ɜːr/. A non-rhotic British model has /ɜː/ without a pronounced r before d. Both are valid accent choices.')

    lesson(5)['title'] = 'Дифтонги и гласные перед r: day, home, near'
    theory(5,1,'Пять частых направлений','В американских day /eɪ/, my /aɪ/, boy /ɔɪ/, go /oʊ/ и now /aʊ/ гласный меняет качество внутри одного слога. Не делай между началом и концом остановку и не читай это как две русские гласные по слогам. Начни медленно, затем верни слово в предложение. Для home наша опора /hoʊm/; британское /həʊm/ — сравнение. Точное движение зависит от говорящего, но важно узнавать слово и сохранять место ударения, а не растягивать все дифтонги одинаково.')
    theory(5,2,'Near и hair: американский гласный с r','В американской словарной записи near /nɪr/, here /hɪr/, hair /her/ и chair /tʃer/ содержат произносимое r. Здесь это группа гласных перед r, а не требование воспроизвести британские центрирующие дифтонги /ɪə/ и /eə/. Переход к r плавный; не добавляй отдельное «э» или новый слог. Британские near /nɪə/ и hair /heə/ полезно узнавать на слух. Современная британская реализация может звучать менее дифтонгично, чем ожидаешь по двум символам. Словарь и аудио конкретного варианта важнее подсчёта знаков.')
    theory(5,3,'Tour и cure: основной US и варианты UK','Американские словарные опоры Oxford — tour /tʊr/ и cure /kjʊr/: r произносится, а cure также начинается с /kj/. Для сравнения Oxford показывает у британского tour /tʊə(r)/ и /tɔː(r)/, у cure /kjʊə(r)/. Скобки (r) у британского варианта относятся к следующему звуку: перед гласным возможно связывание. Это не несколько значений слова. Варианты могут различаться и внутри страны; не делай вывод, что любое слово на ure звучит одинаково. Проверь слово, пометку US или UK и конкретную запись, затем используй его в своей фразе.')
    for w,p in {'go':'/ɡoʊ/','home':'/hoʊm/','near':'/nɪr/','here':'/hɪr/','hair':'/her/','chair':'/tʃer/','tour':'/tʊr/','cure':'/kjʊr/'}.items():word(5,w,p)
    for index,ipa,label,art in [(3,'/oʊ/','go, home: американский GOAT','Начни с округлённого гласного и плавно двигайся к /ʊ/ внутри одного слога; британский /əʊ/ дан только для сравнения.'),(5,'/ɪr/','near, here: гласный перед r','Плавно сохрани r-окраску после гласного, без добавочного слога и раскатистого р.'),(6,'/er/','hair, chair: гласный перед r','Соедини гласный с r; это американская словарная опора, а не британское /eə/ без r.'),(7,'/ʊr/','tour, cure: гласный перед r','В выбранной US-записи сохраняй r. В cure перед гласным есть /j/; проверяй целое слово.')]:
        for key,value in [('ipa',ipa),('label',label),('articulation',art)]:field(5,['sounds',index,key],value)
    field(5,['contrastPairs',1,'left'],'boat /boʊt/')
    field(5,['contrastPairs',2,'left'],'know /noʊ/')
    field(5,['examples',0,'note'],'Три направления в американской опоре: /aɪ/, /eɪ/, /oʊ/.')
    replace(5,['practice','reference'],'home has /əʊ/','home has /oʊ/')
    replace(5,['practice','reference'],'У tour Oxford даёт два британских варианта: /tʊə/ с движением гласного и /tɔː/ с долгим гласным. В американской записи /tʊr/ присутствует произносимое r.','Основная американская запись tour — /tʊr/, с произносимым r. Для сравнения Oxford даёт два британских варианта: /tʊə/ и /tɔː/ перед паузой.')
    # Weak forms are shared. Only lexical vowels/r change, not can/have/the rules.
    word(6,'banana','/bəˈnænə/');word(6,'support','/səˈpɔːrt/')
    lesson(6)['explanation'][0]['body'] += ' В американском banana /bəˈnænə/ ударный гласный /æ/, а края слова слабые. Не путай обычное /ə/ с американским безударным /ər/ в teacher: во втором случае сохраняется r-окраска.'
    word(8,'both','/boʊθ/');word(8,'mother','/ˈmʌðər/')
    theory(9,1,'Right, light — и r после гласного','Для английского /r/ не нужна вибрация, как у русского р. В американском варианте язык может быть собран в середине или слегка загнут назад; не прижимай кончик к альвеолам для раската. У /l/ кончик языка делает контакт, а воздух проходит по бокам; тёмный оттенок l часто слышен особенно в конце слова. Наша модель ротическая: r сохраняется не только в right, но и в car /kɑːr/, cart /kɑːrt/, bird /bɜːrd/. В неротическом британском car перед паузой r не звучит. Сравни записи, но в своей американской фразе не теряй r только из-за позиции после гласного.')
    replace(9,['explanation',2,'body'],'/ˈsɪŋə/','/ˈsɪŋər/')
    replace(9,['explanation',2,'body'],'/ˈfɪŋɡə/','/ˈfɪŋɡər/')
    field(9,['sounds',2,'articulation'],'Создай r-окраску без вибрации кончика языка; допустимы собранное или слегка загнутое положение. Сохраняй этот звук и после гласного в car.')
    word(9,'singer','/ˈsɪŋər/');word(9,'home','/hoʊm/')
    lesson(9)['sounds'][2]['examples'].append({'word':'car','ipa':'/kɑːr/'})
    replace(9,['practice','prompt'],'Прочитай историю и прослушай конечное -ing.','Добавь своё предложение с car или bird и объясни, сохраняется ли r перед паузой в выбранной американской модели. Прочитай историю и прослушай конечное -ing.')
    lesson(9)['practice']['reference'] += ' Our car was parked near the bridge. In this American model, the r in car remains audible even before a pause.'
    lesson(9)['practice']['criteria'].append('Использует car или bird в собственной фразе и объясняет американское r после гласного, сохраняя право на другой акцент.')
    word(10,'measure','/ˈmeʒər/');word(10,'job','/dʒɑːb/')
    field(10,['contrastPairs',2,'left'],'wash /wɑːʃ/')
    field(10,['contrastPairs',2,'right'],'watch /wɑːtʃ/')
    replace(11,['explanation',2,'body'],'though /ðəʊ/','though /ðoʊ/')
    theory(11,3,'O и or: американские группы, не одно правило','В американской опоре o звучит по-разному: hot /hɑːt/, note /noʊt/, love /lʌv/. Немая e помогает в паре not/note, но love показывает ограничение этой подсказки. В sort /sɔːrt/ и work /wɜːrk/ одинаковые or не дают одной гласной; в обоих словах r сохраняется. Запоминай слово с небольшой фразой: hot soup, a short note, this sort of work.\n\nДля сравнения британские hot /hɒt/, sort /sɔːt/ и work /wɜːk/ отличаются от нашей опоры. Они не неправильные, но не требуют менять американскую речь. Сначала предположи звучание по знакомой группе, затем проверь запись US. После проверки произнеси своё предложение, чтобы исключение связалось со смыслом.')
    theory(11,4,'U и c: проверяй слово и акцент','Для u сравни американские cut /kʌt/, push /pʊʃ/, rule /ruːl/ и student /ˈstuːdnt/. В британском student Oxford даёт /ˈstjuːdnt/, с /j/, но в основной US-модели здесь /j/ нет. Это различие не позволяет выбрасывать /j/ из любого слова: use /juːz/ его сохраняет. Собери собственную фразу с каждой проверенной группой.\n\nC часто даёт /k/ перед a/o/u, как в cat, coat, cut, и /s/ перед e/i/y, как в center, city, cycle. Это подсказка, не закон: cello /ˈtʃeloʊ/ начинается с /tʃ/. В cycle первая c — /s/, вторая — /k/. Для сочетаний ch и ck нужны отдельные проверки. Прочитай I cycle to work и I carry a cello целиком; не пытайся произнести слово только по одной букве.')
    theory(11,5,'Ai и air: американский гласный перед r','В train /treɪn/ ai даёт /eɪ/, а said /sed/ не следует той же модели. В американских air /er/ и repair /rɪˈper/ сохраняется r, главное ударение repair — на втором слоге. Не произноси repair как две одинаково сильные части.\n\nДля сравнения британская словарная запись — air /eə(r)/, repair /rɪˈpeə(r)/. В неротической модели r перед паузой отсутствует, а перед следующим гласным может связывать слова. В нашей американской опоре r сохраняется независимо от этого условия. Словарные символы не заставляют делать новый слог: слушай air и repair как цельные слова. Затем используй train, said, air и repair в своём сообщении о поездке или ремонте.')
    word(11,'phone','/foʊn/');word(11,'know','/noʊ/')
    field(11,['examples',3,'note'],'Американская опора: note /oʊ/, hot /ɑː/, work /ɜːr/; это разные реализации o/or.')
    field(11,['examples',4,'note'],'Love /lʌv/, sort /sɔːrt/, work /wɜːrk/; в выбранной американской модели r сохраняется.')
    field(11,['examples',7,'note'],'Said /sed/, train /treɪn/, repair /rɪˈper/ в американской словарной опоре.')
    field(11,['examples',8,'note'],'Ai в train и air различаются; в основной американской модели air /er/ сохраняет r и перед паузой.')
    field(11,['contrastPairs',3,'left'],'sort /sɔːrt/ — US');field(11,['contrastPairs',3,'right'],'work /wɜːrk/ — US')
    field(11,['contrastPairs',3,'note'],'Or не имеет одного универсального чтения; в обоих американских словах сохраняется r.')
    field(11,['contrastPairs',5,'right'],'cello /ˈtʃeloʊ/')
    replace(11,['practice','prompt'],'Выбери UK либо US и отметь одно допустимое различие акцентов.','Используй US как основную опору и отметь одно допустимое отличие UK; осознанный британский вариант также допустим.')
    old=lesson(11)['practice']['reference'];lesson(11)['practice']['reference']=old[:old.index('UK-ориентиры:')]+'US-ориентиры: note /oʊ/, hot /ɑː/, love /ʌ/, sort /ɔːr/, work /ɜːr/; student /uː/ после /st/, push /ʊ/, rule /uː/. Первое c в cycle — /s/, второе — /k/; cello начинается с /tʃ/. Train содержит /eɪ/, said — /e/. Air и repair имеют /er/ в американской записи, с главным ударением на втором слоге repair. Для сравнения британские /eə(r)/ и student /ˈstjuːdnt/ допустимы; их не нужно смешивать с американской опорой внутри упражнения.'
    for w,p in {'worked':'/wɜːrkt/','washed':'/wɑːʃt/','wanted':'/ˈwɑːntɪd/'}.items():word(12,w,p)
    field(12,['contrastPairs',0,'left'],'work → worked /wɜːrkt/')
    field(12,['contrastPairs',0,'right'],'want → wanted /ˈwɑːntɪd/')
    word(13,'watches','/ˈwɑːtʃɪz/')
    field(13,['contrastPairs',1,'left'],'watch /wɑːtʃ/')
    field(13,['contrastPairs',1,'right'],'watches /ˈwɑːtʃɪz/')
    theory(14,1,'Семейство меняется','Американские опоры photograph /ˈfoʊtəɡræf/, photography /fəˈtɑːɡrəfi/ и photographic /ˌfoʊtəˈɡræfɪk/ не сохраняют одно место главного ударения. Меняются и гласные: недостаточно просто усилить другой слог. В photography первый гласный слабый, а главное ударение падает на второй слог. В photographic главное ударение на третьем. Словарные семейства помогают замечать модели, но не дают универсального алгоритма для всех суффиксов. Сначала послушай US-образец, затем прочитай собственное предложение с нужным членом семейства.')
    replace(14,['explanation',2,'body'],'/ˈrekɔːd/','/ˈrekərd/')
    replace(14,['explanation',2,'body'],'/rɪˈkɔːd/','/rɪˈkɔːrd/')
    for index,w,p in [(0,'photograph','/ˈfoʊtəɡræf/'),(1,'photography','/fəˈtɑːɡrəfi/'),(2,'photographic','/ˌfoʊtəˈɡræfɪk/')]:word(14,w,p);field(14,['sounds',index,'ipa'],p)
    field(14,['contrastPairs',0,'left'],'REcord /ˈrekərd/ — существительное')
    field(14,['contrastPairs',0,'right'],'reCORD /rɪˈkɔːrd/ — глагол')
    field(14,['contrastPairs',1,'left'],'thirteen /ˌθɜːrˈtiːn/')
    field(14,['contrastPairs',1,'right'],'thirty /ˈθɜːrti/')

    theory(15,1,'Соединяй, не стирай r','В turn it off конечный согласный плавно переходит к следующему гласному. Границы письменных слов не требуют пауз. В нашей американской модели r в far сохраняется в far away, far from here и перед паузой. Это не звук, который появляется только перед гласным. Для сравнения: в неротическом британском far away возможно linking r, тогда как в far from here r обычно не произносится. Сохраняй смысловые части и не добавляй r в словах без такого основания. Сначала убери случайные разрывы, затем сравни акценты в целых фразах.')
    replace(15,['explanation',3,'body'],'Это встречается после /uː/, /əʊ/ и /aʊ/; британскому /əʊ/ во многих американских вариантах соответствует /oʊ/.','В нашей американской опоре это встречается после /uː/, /oʊ/ и /aʊ/; для сравнения британскому GOAT часто соответствует запись /əʊ/.')
    field(15,['sounds',2,'label'],'r сохраняется и связывает слова')
    field(15,['sounds',2,'articulation'],'В американском far away сохрани r и плавно перейди к away. R остаётся и в far from here; в британской неротической модели условие другое.')
    field(15,['sounds',3,'articulation'],'Квадратные скобки показывают возможное слитное произнесение. Сохрани округление губ после первого гласного и мягко перейди к следующему, без нового слога. Здесь показана американская опора; конкретный TTS может сделать переход менее заметным.')
    for w,p in {'go out':'[ɡoʊw‿aʊt]','two options':'[tuːw‿ˈɑːpʃənz]','know about':'[noʊw‿əˈbaʊt]'}.items():word(15,w,p)
    replace(15,['sounds',0,'articulation'],'practise','practice')
    replace(15,['examples',1,'text'],'practise','practice')
    replace(15,['examples',1,'note'],'practise','practice')
    lesson(15)['explanation'].append({'title':'Американские t и d: короткий tap [ɾ]','body':'В обычной американской речи t и d могут звучать как очень короткое касание языка [ɾ]: например, city, better и ladder. Частая позиция — после ударного гласного перед безударным. Это не правило заменить любую t на d: в начале table и перед ударным гласным в attack нужна другая опора. В словарях можно увидеть /t/ в широкой записи или специальный /t̬/; [ɾ] показывает конкретный вариант звучания. Касание короткое, без долгой смычки и без раската. Ясная форма с /t/ тоже допустима; темп, выделение и говорящий влияют на реализацию. Слушай знакомое слово в предложении и сохраняй его написание и смысл.'})
    lesson(15)['sounds'].append({'ipa':'[ɾ]','label':'возможный американский tap у t и d','articulation':'Одно короткое касание кончика языка у альвеол, без раскатистого r. Показаны возможные реализации; нейтральный синтезатор не гарантирует их.','examples':[{'word':'city','ipa':'[ˈsɪɾi]'}, {'word':'better','ipa':'[ˈbɛɾɚ]'}, {'word':'ladder','ipa':'[ˈlæɾɚ]'}]})
    lesson(15)['examples'].extend([{'text':'The city looks better after the rain.','note':'В city и better часто слышен короткий [ɾ]. Сначала узнай слова и ударение, затем сравни их средние согласные.'},{'text':'I left the ladder beside the table.','note':'D в ladder может звучать как [ɾ]; начальную t в table это правило не превращает в tap.'}])
    lesson(15)['contrastPairs'].append({'left':'better: возможный [ɾ]','right':'attack: t перед ударным гласным','leftAudio':'better','rightAudio':'attack','note':'Положение и ударение важны. Это разные слова, не пара значений одной формы; не заменяй каждую t на d.'})
    lesson(15)['practice']['prompt'] += ' Американская связная речь: напиши ещё три своих предложения с city, better и ladder. Найди в них возможные места [ɾ], объясни, почему начальная t в table под это условие не подходит. Послушай US-записи этих слов и прочитай свои фразы, сохраняя ясную речь; заметный tap не обязателен.'
    lesson(15)['practice']['reference'] += ' My city has a new library. I feel better after a short walk. We used a ladder to reach the shelf. The middle consonants in city, better, and ladder may be short taps in ordinary American speech. The initial t in table is not between these vowels, so this example does not fit the pattern. A clear t is also acceptable; I need to compare an actual recording before describing my own sound.'
    lesson(15)['practice']['criteria'].append('Пишет три собственные фразы с city, better, ladder, учитывает ударение и позицию tap; не требует заменять любую t/d и не выдаёт текст за акустическую оценку.')
    lesson(15)['minutes'] = 50
    # Same open task, American orthography; accent guidance does not imply an acoustic score.
    replace(16,['practice','reference'],'apologised','apologized')
    replace(16,['practice','reference'],'practise','practice')
    lesson(16)['explanation'][2]['body'] += ' Для основной практики выбери живой американский образец с понятным содержанием. Британский или другой региональный вариант можно изучать для сравнения; не исправляй все отличия в нём как ошибки и не требуй от себя копировать личность говорящего.'
    additions=[('Oxford: US/UK IPA, r и tap t',GUIDE),('Исследование: региональное слияние cot–caught',MERGER),('Исследование: English Voicing in Dimensional Theory, flapping и ограничения',FLAP)]
    for key,title in [('bath_1','bath'),('cot','cot'),('caught','caught'),('wash_1','wash'),('photograph_1','photograph'),('photography','photography'),('record_1','record (noun)'),('record_2','record (verb)')]:
        additions.append((f'Oxford: {title}, US/UK','https://www.oxfordlearnersdictionaries.com/definition/english/'+key))
    urls={s['url'] for s in data['sources']}
    data['sources'] += [{'title':title,'url':url} for title,url in additions if url not in urls]
    validate(data,original)
    return data


def audio_texts(data):
    texts=set()
    for l in data['lessons']:
        texts.update(e['text'] for e in l['examples'])
        for s in l['sounds']:
            texts.update(e.get('audio',e['word']) for e in s['examples'] if e.get('audio',e['word']) is not None)
        for pair in l['contrastPairs']:
            texts.update(pair[k] for k in ['leftAudio','rightAudio'] if pair.get(k))
    return texts


def validate(data, original=None):
    ids=[l['id'] for l in data['lessons']]
    assert len(ids)==16 and len(set(ids))==16
    if original:
        assert ids==[l['id'] for l in original['lessons']]
        for before,after in zip(original['lessons'],data['lessons']):
            assert before['level']==after['level']
            assert len(after['explanation'])>=len(before['explanation'])
            assert len(after['practice']['criteria'])>=len(before['practice']['criteria'])
    for l in data['lessons']:
        assert all(isinstance(l['practice'][k],str) and l['practice'][k].strip() for k in ['prompt','reference'])
        assert all(s['body'].strip() for s in l['explanation'])
        for s in l['sounds']:
            assert 'əʊ' not in s['ipa'] and 'ɒ' not in s['ipa']
            for e in s['examples']:
                assert 'əʊ' not in e['ipa'] and 'ɒ' not in e['ipa'], e
    for text in audio_texts(data):
        assert re.fullmatch(r'''[A-Za-z0-9\s.,!?'":;()\-]+''',text), text


def changes(before, after, path=()):
    if isinstance(before,dict) and isinstance(after,dict) and before.keys()==after.keys():
        return [v for k in before for v in changes(before[k],after[k],(*path,k))]
    if isinstance(before,list) and isinstance(after,list) and len(before)==len(after):
        return [v for i,(a,b) in enumerate(zip(before,after)) for v in changes(a,b,(*path,i))]
    return [] if before==after else [{'path':list(path),'before':before,'after':after}]


def atomic(path, raw):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,name=tempfile.mkstemp(prefix=path.name+'.',suffix='.tmp',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as stream: stream.write(raw);stream.flush();os.fsync(stream.fileno())
        os.replace(name,path)
    finally:
        if os.path.exists(name):os.unlink(name)


def run(path, report_path, backup_dir, apply=False):
    raw=path.read_bytes()
    if sha(raw)!=BEFORE_SHA:
        if report_path.exists():
            receipt=json.loads(report_path.read_text('utf-8'))
            if receipt.get('version')==VERSION and receipt.get('afterSHA256')==sha(raw):
                validate(json.loads(raw));return {'state':'already-applied','afterSHA256':sha(raw)}
        raise ValueError('Source hash changed; refusing to overwrite pronunciation content')
    original=json.loads(raw);result=migrate(original);output=encoded(result)
    receipt={'version':VERSION,'beforeSHA256':sha(raw),'afterSHA256':sha(output),'reviewedLessons':16,'acousticReview':False,'sources':[GUIDE,MERGER,FLAP],'changes':changes(original,result),'lessons':[{'id':a['id'],'beforeSHA256':sha(encoded(a)),'afterSHA256':sha(encoded(b)),'changed':a!=b} for a,b in zip(original['lessons'],result['lessons'])],'audio':{'beforeCount':len(audio_texts(original)),'afterCount':len(audio_texts(result)),'added':sorted(audio_texts(result)-audio_texts(original)),'removed':sorted(audio_texts(original)-audio_texts(result))}}
    if apply:
        backup=backup_dir/f'pronunciation-before-us-{sha(raw)}.json'
        if backup.exists() and backup.read_bytes()!=raw:raise ValueError('Backup collision')
        if not backup.exists():atomic(backup,raw)
        if path.read_bytes()!=raw:raise ValueError('Source changed during migration')
        # Receipt first permits recovery if interrupted between the two atomic replacements.
        atomic(report_path,encoded(receipt));atomic(path,output)
    return {'state':'applied' if apply else 'dry-run','beforeSHA256':sha(raw),'afterSHA256':sha(output),'changedLessons':sum(x['changed'] for x in receipt['lessons']),'changedFields':len(receipt['changes']),'audio':receipt['audio']}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');args=p.parse_args()
    print(json.dumps(run(APP/'content/pronunciation.json',APP/'data/pronunciation-us-migration.json',APP/'data/backups',args.apply),ensure_ascii=False,indent=2))

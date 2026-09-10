"""Build a complete, auditable catalog from the user's 11 locally supplied PDFs.

Run catalog_extract.py and catalog_headers.py first. This script writes metadata
only; book text for the local reader is stored separately under ignored data/.
"""
from pathlib import Path
import json, re

ROOT = Path(__file__).resolve().parents[2]
TOC = ROOT / 'app/content/toc'
PAGES = TOC / 'catalog-pages'
manual = json.loads((TOC / 'catalog-manual.json').read_text(encoding='utf8'))
source_manifest = json.loads((PAGES / 'manifest.json').read_text(encoding='utf8'))

def normalize(text):
    return re.sub(r'\s+', ' ', text).replace('\ufffd', "'").strip()

def parse_toc(index, page_numbers, categories, count, printed_numbers=False):
    entries = []
    category = ''
    active = None
    def flush():
        nonlocal active
        if active:
            active['title'] = normalize(active['title'])
            if printed_numbers:
                m = re.search(r'\s(\d+)$',active['title'])
                assert m, (index,active)
                active['printedPage'] = int(m[1])
                active['title'] = active['title'][:m.start()].strip()
            entries.append(active)
            active = None
    for page in json.loads((PAGES / f'{index:02d}.json').read_text(encoding='utf8')):
        if page['page'] not in page_numbers:
            continue
        page_text = page['text'].replace('Phrasal verbs and verb-based\nexpressions','Phrasal verbs and verb-based expressions')
        for line in page_text.splitlines():
            line = normalize(line)
            if not line or re.search(r'English (?:Vocabulary|Phrasal Verbs) in Use',line):
                continue
            if line in categories:
                flush()
                category = categories[line]
                continue
            m = re.match(r'^(\d{1,3})\s+(.+)',line)
            if m and int(m[1]) == len(entries)+1+(1 if active else 0):
                flush()
                active = {'unit':int(m[1]),'title':m[2],'category':category,'tocPage':page['page']}
            elif line.startswith(('Answer key','Key ','Index','Phonemic symbols','Acknowledgements','Enhanced ebook')):
                flush()
            elif active:
                active['title'] += ' '+line
    flush()
    assert len(entries)==count, (index,len(entries),entries[-3:])
    assert [x['unit'] for x in entries]==list(range(1,count+1))
    return entries

def ranges(definitions):
    return [(start,end,category) for start,end,category in definitions]

def category_at(unit, definitions):
    return next(category for start,end,category in definitions if start<=unit<=end)

def named_units(titles, definitions):
    return [{'unit':i,'title':title,'category':category_at(i,definitions)} for i,title in enumerate(titles,1)]

COL_INT = ranges([(1,5,'Learning about collocations'),(6,9,'Grammatical aspects of collocations'),(10,12,'Special aspects of collocation'),(13,16,'Travel and the environment'),(17,20,'People and relationships'),(21,26,'Leisure and lifestyle'),(27,33,'Work and study'),(34,39,'Society and institutions'),(40,50,'Basic concepts'),(51,60,'Functions')])
COL_ADV = ranges([(1,5,'Learning about collocations'),(6,10,'Varieties of collocations'),(11,18,'Work and study'),(19,29,'Leisure and lifestyle'),(30,39,'The modern world'),(40,45,'People'),(46,51,'Basic concepts'),(52,60,'Functions')])
PHR_INT = ranges([(1,5,'Learning about phrasal verbs'),(6,12,'Key verbs'),(13,21,'Key particles'),(22,31,'Concepts'),(32,41,'Functions'),(42,50,'Work, study and finance'),(51,60,'Personal life'),(61,70,'The world around us')])
GRAM_ADV = ranges([(1,8,'Tenses'),(9,14,'The future'),(15,20,'Modals and semi-modals'),(21,27,'Linking verbs, passives, questions'),(28,31,'Verb complementation: what follows verbs'),(32,39,'Reporting'),(40,43,'Nouns'),(44,52,'Articles, determiners and quantifiers'),(53,59,'Relative clauses and other types of clause'),(60,65,'Pronouns, substitution and leaving out words'),(66,78,'Adjectives and adverbs'),(79,87,'Adverbial clauses and conjunctions'),(88,94,'Prepositions'),(95,100,'Organising information')])
GRAM_ELEM = ranges([(1,9,'Present'),(10,14,'Past'),(15,20,'Present perfect'),(21,22,'Passive'),(23,24,'Verb forms'),(25,28,'Future'),(29,36,'Modals, imperative etc.'),(37,39,'There and it'),(40,43,'Auxiliary verbs'),(44,49,'Questions'),(50,50,'Reported speech'),(51,54,'-ing and to …'),(55,58,'Go, get, do, make and have'),(59,64,'Pronouns and possessives'),(65,73,'A and the'),(74,84,'Determiners and pronouns'),(85,92,'Adjectives and adverbs'),(93,96,'Word order'),(97,102,'Conjunctions and clauses'),(103,113,'Prepositions'),(114,115,'Phrasal verbs')])
VOC_ELEM = ranges([(1,9,'People'),(10,13,'At home'),(14,17,'School and workplace'),(18,26,'Leisure'),(27,33,'The world'),(34,37,'Social issues'),(38,49,'Everyday verbs'),(50,60,'Words and grammar')])

def catmap(*names):
    return {n:n for n in names}

phrasal_adv = parse_toc(3,[5,6],catmap('Learning about phrasal verbs','Interesting aspects of phrasal verbs','Key particles','Concepts','Functions','Work, study and finance','Personal life','The world around us','Key verbs'),60,True)
vocab_adv_cats = catmap('Work and study','People and relationships','Leisure and lifestyle','Travel','The environment','Society and institutions','The media','Health','Technology','Basic concepts','Functional vocabulary','Words and meanings','Language variation')
vocab_adv_cats.update({'Fixed expressions and':'Fixed expressions and figurative language',"figurative'language":'Fixed expressions and figurative language','figurative language':'Fixed expressions and figurative language'})
vocab_adv = parse_toc(9,[5,6],vocab_adv_cats,101,True)
vocab_upper_cats = catmap('Effective vocabulary learning','Topics','Feelings and actions','Basic concepts','Connecting and linking words','Word formation','Words and pronunciation','Counting people and things','Varieties and styles')
vocab_upper_cats.update({'Phrasal verbs and verb-based expressions':'Phrasal verbs and verb-based expressions'})
vocab_upper = parse_toc(11,[4,5],vocab_upper_cats,101)
egiu_topics = [x for x in json.loads((ROOT/'app/content/topics.json').read_text(encoding='utf8')) if x['book']=='egiu']
assert len(egiu_topics)==145
egiu_units = [{'unit':int(t['unit']),'title':t['title'],'titleRu':t['title_ru'],'category':t['category'],'topicId':t['id']} for t in egiu_topics]
essential_titles = (TOC / 'catalog-essential-titles.txt').read_text(encoding='utf8').splitlines()
assert len(essential_titles)==115

BOOK_DEFS = [
    (1,'collocations-advanced','English Collocations in Use Advanced','C1–C2',named_units(manual['collocations-advanced'],COL_ADV),[5,6],8),
    (2,'collocations-intermediate','English Collocations in Use Intermediate','B1–B2',named_units(manual['collocations-intermediate'],COL_INT),[5,6],8),
    (3,'phrasal-advanced','English Phrasal Verbs in Use Advanced','C1–C2',phrasal_adv,[5,6],8),
    (4,'phrasal-intermediate','English Phrasal Verbs in Use Intermediate','B1–B2',named_units(manual['phrasal-intermediate'],PHR_INT),[3,4],6),
    (5,'grammar-advanced','Advanced Grammar in Use · Third edition','C1–C2',named_units(manual['grammar-advanced'],GRAM_ADV),[4,5,6],11),
    (6,'grammar-intermediate','English Grammar in Use · Fourth edition','B1–B2',egiu_units,[4,5,6,7],11),
    (7,'grammar-elementary','Essential Grammar in Use · Ebook 2015','A1–A2',named_units(essential_titles,GRAM_ELEM),[],0),
    (8,'grammar-intermediate-ebook','English Grammar in Use · Fourth edition ebook','B1–B2',egiu_units,[],0),
    (9,'vocabulary-advanced','English Vocabulary in Use Advanced','C1–C2',vocab_adv,[5,6],8),
    (10,'vocabulary-elementary','English Vocabulary in Use Elementary','A1–A2',named_units(manual['vocabulary-elementary'],VOC_ELEM),[4,5],7),
    (11,'vocabulary-upper-intermediate','English Vocabulary in Use Upper-intermediate','B1–B2',vocab_upper,[4,5],7),
]

books = []
for index, book_id, title, level, entries, toc_pages, page_offset in BOOK_DEFS:
    meta = source_manifest[index-1]
    book = {
        'id':book_id,'title':title,
        'author':'Martin Hewings' if index==5 else 'Raymond Murphy' if index in (6,7,8) else "Michael McCarthy & Felicity O'Dell",
        'filename':meta['filename'],'level':level,'unitCount':len(entries),
        'verified':True,'tocPages':toc_pages,'pdfPageCount':meta['pages'],
        'source':'ocr-and-visual-toc' if index in (4,5) else 'unit-headings' if index in (7,8) else 'pdf-text-toc',
        'notes':'Нумерация и названия всех учебных юнитов сверены с локальной книгой. Уровень — ориентир для маршрута, а не результат тестирования.',
        'units':[],
    }
    if index==7:
        book['notes']='В этом ebook нет обычного оглавления: все 115 тем восстановлены по заголовкам юнитов 1–115. Базовый маршрут A1–A2; отдельные темы подходят для повторения перед B1.'
    if index==8:
        book['duplicateOf']='grammar-intermediate'
        book['notes']='Имя файла ошибочно содержит Essential. Внутри — English Grammar in Use, 4-е издание: copyright2015, printed2012; все 145 тем совпадают с PDF2012. Это второй формат той же книги, а не 145 новых тем.'
    for entry in entries:
        unit=dict(entry)
        unit['id']=f'{book_id}-{unit["unit"]:03d}'
        unit['page']=2*unit['unit']+page_offset
        unit['endPage']=unit['page']+1
        unit['verified']=True
        if not unit.get('tocPage') and toc_pages:
            if index in (1,2):
                unit['tocPage']=5 if unit['unit']<=(29 if index==1 else 26) else 6
            elif index==4:
                unit['tocPage']=3 if unit['unit']<=56 else 4
            elif index==5:
                unit['tocPage']=4 if unit['unit']<=31 else 5 if unit['unit']<=65 else 6
            elif index==6:
                unit['tocPage']=4 if unit['unit']<=37 else 5 if unit['unit']<=78 else 6 if unit['unit']<=120 else 7
            elif index==10:
                unit['tocPage']=4 if unit['unit']<=33 else 5
        if index==8:
            unit['equivalentUnitId']=f'grammar-intermediate-{unit["unit"]:03d}'
        assert unit['page']>0 and unit['endPage']<=meta['pages']
        book['units'].append(unit)
    books.append(book)

catalog = {
    'version':1,'auditedAt':'2026-09-09',
    'scope':'Все нумерованные учебные юниты в 11 PDF пользователя. Приложения, ключи и алфавитные индексы не считаются отдельными уроками.',
    'totalBooks':len(books),'uniqueBooks':10,
    'totalUnits':sum(b['unitCount'] for b in books),
    'uniqueUnits':sum(b['unitCount'] for b in books if not b.get('duplicateOf')),
    'books':books,
}
assert catalog['totalUnits']==1017
assert catalog['uniqueUnits']==872
ids=[u['id'] for b in books for u in b['units']]
assert len(ids)==len(set(ids))
(ROOT/'app/content/library.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
for b in books:
    print(b['id'],b['unitCount'],b['units'][0]['title'],'...',b['units'][-1]['title'])
print('TOTAL',catalog['totalUnits'],'UNIQUE',catalog['uniqueUnits'])

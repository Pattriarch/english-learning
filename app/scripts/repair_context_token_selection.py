"""Stage explicit repairs of the old ASCII-token selection cache.

Original contexts/IDs are retained but excluded from study. Existing correct
alternatives are selected. Two source-attributed contexts supply mar and es.
The completion input keeps a copy of revision 1; only affected rows change.
"""
import copy
import hashlib

from complete_context_lexicon import BANK, WORK, read, input_row, fingerprint, apply_selection_repairs
from build_context_lexicon import atomic_json, target_spans


def prepare_repairs():
    if (WORK / 'input-revision-1.json').exists():
        raise ValueError('Repairs already staged; do not rewrite reviewed input')
    document = read(BANK / 'entries.json')
    source = {'id': 'editorial-token-selection-repair-2026-09',
        'title': 'Unicode token-selection corrections and replacement examples',
        'author': 'English project contributors with AI-assisted review',
        'license': 'original-project-content', 'checkedAt': '2026-09-10',
        'reviewMethod': 'Full-bank Unicode boundary audit; new selected meanings receive independent AI semantic review'}
    exclusions = []
    for entry in document['entries']:
        for context in entry['contexts']:
            invalid = context['source']['sourceId'] == 'tatoeba-eng' and context['targetSpans'] != target_spans(context['en'], entry['word'])
            wrong_wow = entry['word'] == 'wow' and context['id'] == 'tatoeba-4979258-4978922'
            if invalid or wrong_wow:
                reason = ('Старый отбор выделил фрагмент внутри другого слова с диакритикой; это не пример употребления заголовочного слова.'
                          if invalid else 'WoW здесь — название игры World of Warcraft, а не изучаемое междометие wow. Для обучения выбран другой пример.')
                exclusions.append({'entryId': entry['id'], 'contextId': context['id'],
                    'baseSHA256': fingerprint(entry, context), 'reason': reason})
    by_word = {e['word']: e for e in document['entries']}
    mar = by_word['mar']
    sense = mar['senses'][0]
    example = sense['examples'][0]
    mar_context = {'id': 'wiktionary-' + hashlib.sha256((sense['id']+'\0'+example['en']).encode()).hexdigest()[:16],
        'en': example['en'], 'ru': None, 'targetSpans': example['targetSpans'],
        'senseId': sense['id'], 'variety': 'unverified', 'source': sense['source'],
        'alignment': 'source dictionary example; Russian translation pending independent review', 'quality': 'source-linked-context'}
    es = by_word['es']
    es_text = 'She wrote three es in the margin while practicing the alphabet.'
    es_context = {'id': es['id']+'-context-token-repair-1', 'en': es_text, 'ru': None,
        'targetSpans': target_spans(es_text, 'es'), 'senseId': None, 'variety': 'unverified',
        'source': {'sourceId': source['id'], 'license': source['license'], 'attribution': source['author'], 'kind': 'original-editorial'},
        'alignment': 'original example; separate semantic review pending', 'quality': 'editorial-draft',
        'verificationSources': [{'url': 'https://www.merriam-webster.com/dictionary/es',
            'checkedAt': '2026-09-10', 'note': 'Dictionary recognizes es as the plural of the letter e; this is a letter-name plural, not an independent everyday lemma.'}]}
    rep = by_word['rep']
    rep_text = 'The sales rep called to explain the delivery options.'
    rep_context = {'id': rep['id']+'-context-token-repair-1', 'en': rep_text, 'ru': None,
        'targetSpans': target_spans(rep_text, 'rep'), 'senseId': None, 'variety': 'unverified',
        'source': {'sourceId': source['id'], 'license': source['license'], 'attribution': source['author'], 'kind': 'original-editorial'},
        'alignment': 'original example; separate semantic review pending', 'quality': 'editorial-draft',
        'verificationSources': [{'url': 'https://www.merriam-webster.com/dictionary/rep',
            'checkedAt': '2026-09-10', 'note': 'Representative, especially salesperson; original project example.'}]}
    repairs = {'version': 'token-selection-repair-v1', 'source': source, 'exclusions': exclusions,
        'additionalContexts': [{'entryId': mar['id'], 'context': mar_context}, {'entryId': rep['id'], 'context': rep_context},
            {'entryId': es['id'], 'context': es_context, 'lexicalType': 'letter-name-plural', 'displayHeadword': 'es (plural of e)'}]}
    repaired = apply_selection_repairs(document, repairs)
    by_id = {e['id']: e for e in repaired['entries']}
    snapshot = read(WORK / 'input.json')
    atomic_json(WORK / 'input-revision-1.json', snapshot)
    replacements = {}
    for index, row in enumerate(snapshot['rows']):
        entry = by_id[row['entryId']]
        context = next(c for c in entry['contexts'] if c['id'] == row['contextId'])
        if context.get('excludedFromStudy'):
            replacement = input_row(entry, next(c for c in entry['contexts'] if not c.get('excludedFromStudy')))
            replacements[row['rowId']] = replacement
            snapshot['rows'][index] = replacement
    snapshot['rows'].append(input_row(by_id[mar['id']], mar_context))
    snapshot['revision'] = 2
    snapshot['revisionReason'] = 'Independent review found ASCII-substring matches; excluded originals retained and correct alternate contexts selected.'
    # Existing unaffected draft rows remain, affected draft rows are replaced
    # by a new small drafting pass before the entire batch is re-reviewed.
    for folder in (WORK / 'batches').iterdir():
        draft_path = folder / 'draft.json'
        if not draft_path.exists():
            continue
        draft = read(draft_path)
        if not any(r['rowId'] in replacements for r in draft['rows']):
            continue
        atomic_json(folder / 'draft-revision-1.json', draft)
        draft['rows'] = [r for r in draft['rows'] if r['rowId'] not in replacements]
        # Apply the nonblocked corrections from the completed first review.
        review_path = folder / 'review-1.json'
        if review_path.exists():
            fixes = {r['rowId']: r for r in read(review_path)['corrections']}
            draft['rows'] = [fixes.get(r['rowId'], r) for r in draft['rows']]
        draft['inputRevision'] = 2
        atomic_json(draft_path, draft)
    atomic_json(WORK / 'prepared-selection-repairs.json', repairs)
    atomic_json(WORK / 'input.json', snapshot)
    print({'excludedContexts': len(exclusions), 'replacedInputRows': len(replacements), 'totalInputRows': len(snapshot['rows'])})


if __name__ == '__main__':
    prepare_repairs()

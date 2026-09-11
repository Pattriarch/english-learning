"""Hash-bound example revisions shared by amendment verification/publication."""
import copy
from pathlib import Path
import re

import enrich_lexicon as full


def verified_history(receipt, inputs, folder, stack=(), cache=None):
    revisions, histories = receipt.get('exampleRevisions', {}), receipt.get('exampleHistory', {})
    if not isinstance(revisions, dict) or not isinstance(histories, dict) or revisions.keys() != histories.keys():
        raise ValueError('Example revision/history targets differ')
    current = {row['rowId']: row for row in receipt['rows']}
    if not revisions.keys() <= current.keys():
        raise ValueError('Unknown example revision target')
    archives, result = {}, {}
    cache = {} if cache is None else cache
    for row_id, revision in revisions.items():
        history = histories[row_id]
        if (type(revision) is not int or not 2 <= revision <= 32 or not isinstance(history, list)
                or len(history) != revision - 1 or current[row_id]['action'] != 'replace'):
            raise ValueError('Invalid explicit example revision')
        result[row_id] = []
        previous_english = set()
        for number, record in enumerate(history, 1):
            if (not isinstance(record, dict) or set(record) != {'exampleRevision', 'receiptFile', 'receiptSHA256', 'rowSHA256'}
                    or type(record['exampleRevision']) is not int or record['exampleRevision'] != number):
                raise ValueError('Non-contiguous example history')
            name, sha = record['receiptFile'], record['receiptSHA256']
            if (not isinstance(name, str) or not re.fullmatch(r'verified-before-amendment-[0-9a-f]{64}\.json', name)
                    or name != f'verified-before-amendment-{sha}.json'):
                raise ValueError('Invalid example history archive path')
            path = (Path(folder) / name).resolve()
            if path.parent != Path(folder).resolve() or sha in stack:
                raise ValueError('Cyclic or unsafe example history archive')
            if sha not in archives:
                raw = path.read_bytes()
                if full.hashlib.sha256(raw).hexdigest() != sha:
                    raise ValueError('Example history archive changed')
                cache_key = (str(Path(folder).resolve()), full.value_sha(inputs), sha)
                previous = cache.get(cache_key)
                if previous is None:
                    previous = full.json.loads(raw)
                    full.verify_receipt(previous, inputs, folder, _history_stack=(*stack, sha), _history_cache=cache)
                    cache[cache_key] = previous
                archives[sha] = previous
            previous = archives[sha]
            before = next((row for row in previous['rows'] if row['rowId'] == row_id), None)
            if (before is None or full.value_sha(before) != record['rowSHA256']
                    or previous.get('exampleRevisions', {}).get(row_id, 1) != number
                    or previous.get('exampleHistory', {}).get(row_id, []) != history[:number - 1]):
                raise ValueError('Example history does not bind its exact prior row/chain')
            if before['en'] in previous_english:
                raise ValueError('Example revision did not change its English identity')
            previous_english.add(before['en'])
            result[row_id].append((record, previous, before))
        if current[row_id]['en'] in previous_english:
            raise ValueError('Current example repeats its previous identity')
    return result


def published_row(row, source, receipt, receipt_sha):
    return {**copy.deepcopy(row), **{key: source[key] for key in ('entryId', 'contextId', 'sourceContextSHA256')},
            'targetSpans': full.spans_for(row, source),
            'review': {'inputSHA256': receipt['inputSHA256'], 'outputSHA256': full.value_sha(row),
                       'receiptSHA256': receipt_sha, 'semanticReviewSHA256': receipt['accepted'][row['rowId']]['sha256']}}


def publication_metadata(receipt, inputs, folder):
    sources = {row['rowId']: row for row in inputs}
    histories = verified_history(receipt, inputs, folder)
    return {row_id: {'exampleRevision': receipt['exampleRevisions'][row_id],
                     'previousAnalyses': [{'exampleRevision': record['exampleRevision'],
                                           'receiptSHA256': record['receiptSHA256'],
                                           'row': published_row(before, sources[row_id], previous, record['receiptSHA256'])}
                                          for record, previous, before in chain]}
            for row_id, chain in histories.items()}

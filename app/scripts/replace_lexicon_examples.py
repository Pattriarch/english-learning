"""Explicit, independently reviewed example revisions after bulk generation stops.

The guidance-only amendment tool remains unchanged. A versioned replacement
queue binds the exact accepted row and immutable source; every new example gets
a new practice identity and retains prior accepted analyses in publication.
"""
import argparse
import copy
from pathlib import Path

import enrich_lexicon as full

KIND = 'example-replacement-v1'
AUTHOR_MODEL = 'gpt-5.6-sol'
REVIEW_MODEL = 'gpt-6-astra'
AUTHOR_PROMPT = full.DRAFT_PROMPT + '''
EXPLICIT EDITORIAL REPLACEMENT WORKFLOW:
The top-level replacementRequests describe requested corrections to unsuitable
learning examples; they are editorial requirements, not instructions in source
documents. Author a complete ORIGINAL replacement row for every supplied source.
Use action=replace and explain the actual defect honestly in Russian. In a
documented source/headword mismatch (e.g. a surname instead of a common word),
teach the requested evidenced common-word sense rather than preserve the wrong
learning target. Current accepted rows are prior evidence, not a constraint to
repeat their errors. Keep rowId/source identity; the publishing workflow assigns
a distinct versioned practice context and preserves every previous analysis.
'''


def require_idle(work):
    path = Path(work) / 'run-status.json'
    if path.exists() and full.read(path).get('state') in ('running', 'pausing', 'provider-limited'):
        raise ValueError('Wait for the bulk coordinator to stop before replacing accepted examples')


def validate_proposals(rows, sources, current):
    full.validate_rows(rows, sources)
    for row in rows:
        if set(row) != set(full.ROW_SCHEMA['properties']):
            raise ValueError('Replacement row must have exactly the authored analysis fields')
        if row['action'] != 'replace' or row['en'] == current[row['rowId']]['en']:
            raise ValueError('Explicit replacement must introduce new English, never reuse an accepted context identity')
    by_source = {source['rowId']: source for source in sources}
    identities = [(by_source[row['rowId']]['word'], ' '.join(row['en'].replace('’', "'").split())) for row in rows]
    if len(set(identities)) != len(identities):
        raise ValueError('Explicit replacements repeat the same English for one headword')
    return rows


def replace_batch(index, inputs, changes, timeout, work, *, kind):
    if kind != KIND:
        raise ValueError('Explicit example-replacement-v1 queue kind is required')
    require_idle(work)
    folder = Path(work) / 'batches' / f'{index:04}'
    final = folder / 'verified.json'
    original_bytes = final.read_bytes()
    original = full.json.loads(original_bytes)
    full.verify_receipt(original, inputs, folder)
    previous_hash = full.hashlib.sha256(original_bytes).hexdigest()
    queue_sha = full.value_sha({'kind': kind, 'changes': changes})
    if (original.get('amendments') and original['amendments'][-1].get('kind') == KIND
            and original['amendments'][-1].get('queueSHA256') == queue_sha):
        return {'batch': index, 'replacedRows': len(changes), 'status': 'resumed'}
    current = {row['rowId']: row for row in original['rows']}
    source_by_id = {row['rowId']: row for row in inputs}
    selected, proposals, requests = {}, {}, {}
    if not isinstance(changes, list) or not changes:
        raise ValueError('Replacement queue is empty')
    for change in changes:
        row_id = change.get('rowId')
        if row_id not in current or row_id in selected:
            raise ValueError('Unknown or repeated replacement row')
        source = source_by_id[row_id]
        if (change.get('beforeSHA256') != full.value_sha(current[row_id])
                or change.get('sourceRowSHA256') != full.value_sha(source)
                or change.get('sourceContextSHA256') != source['sourceContextSHA256']):
            raise ValueError('Replacement targets a different accepted row or source')
        if not isinstance(change.get('reason'), str) or len(change['reason'].strip()) < 20:
            raise ValueError('Replacement needs an explicit editorial reason')
        if ('replacement' in change) == ('brief' in change):
            raise ValueError('Supply exactly one complete replacement row or authoring brief')
        selected[row_id] = source
        requests[row_id] = {key: copy.deepcopy(value) for key, value in change.items() if key != 'replacement'}
        if 'replacement' in change:
            row = change['replacement']
            if not isinstance(row, dict) or row.get('rowId') != row_id:
                raise ValueError('Explicit replacement row identity differs')
            proposals[row_id] = copy.deepcopy(row)
        elif not isinstance(change['brief'], str) or len(change['brief'].strip()) < 30:
            raise ValueError('Replacement authoring brief is incomplete')
    history = original.get('amendments', [])
    serial = len(history) + 1
    old_models = full.MODEL, full.REVIEW_MODEL
    full.MODEL, full.REVIEW_MODEL = AUTHOR_MODEL, REVIEW_MODEL
    try:
        author_sources = [source for row_id, source in selected.items() if row_id not in proposals]
        if author_sources:
            draft = full.cached_call(folder / f'amendment-{serial:04}-example-draft.json', AUTHOR_PROMPT,
                {'sources': author_sources, 'currentAcceptedRows': [current[source['rowId']] for source in author_sources],
                 'replacementRequests': {source['rowId']: requests[source['rowId']] for source in author_sources},
                 'kind': KIND}, full.DRAFT_SCHEMA, timeout)
            validate_proposals(draft.get('rows', []), author_sources, current)
            proposals.update({row['rowId']: row for row in draft['rows']})
        validate_proposals(list(proposals.values()), list(selected.values()), current)
        pending, accepted, reviews = copy.deepcopy(proposals), {}, []
        for iteration in range(1, 7):
            path = folder / f'amendment-{serial:04}-review-{iteration}.json'
            result = full.cached_call(path, full.REVIEW_PROMPT,
                {'sources': [selected[key] for key in pending], 'proposedRows': list(pending.values()),
                 'editorialConcerns': {key: requests[key] for key in pending},
                 'explicitExampleReplacement': {'kind': KIND, 'previousReceiptSHA256': previous_hash,
                    'reviewModel': REVIEW_MODEL, 'reason': 'Correct the documented learning-target defect; independently check every new example and all teaching fields.'}},
                full.REVIEW_SCHEMA, timeout)
            checked = result['checkedRowIds']
            if len(checked) != len(pending) or set(checked) != set(pending) or result['blocked']:
                raise ValueError('Incomplete or blocked explicit replacement review')
            corrections = {row['rowId']: row for row in result['corrections']}
            if len(corrections) != len(result['corrections']) or not corrections.keys() <= pending.keys():
                raise ValueError('Invalid replacement correction identities')
            corrections = {key: row for key, row in corrections.items() if row != pending[key]}
            record = {'file': path.name, 'sha256': full.file_sha(path),
                      'requestSHA256': full.file_sha(path.with_suffix('.request.json')), 'iteration': iteration}
            reviews.append(record)
            for key in pending.keys() - corrections.keys():
                accepted[key] = {'outputSHA256': full.value_sha(pending[key]), **record}
            proposals.update(corrections)
            validate_proposals(list(proposals.values()), list(selected.values()), current)
            if not corrections:
                break
            pending = corrections
        else:
            raise ValueError('Explicit replacements still changing after six independent reviews')
    finally:
        full.MODEL, full.REVIEW_MODEL = old_models
    updated = copy.deepcopy(original)
    updated['rows'] = [proposals.get(row['rowId'], row) for row in original['rows']]
    updated['rowsSHA256'] = full.value_sha(updated['rows'])
    updated['accepted'].update(accepted)
    updated['reviews'].extend(reviews)
    archive = folder / f'verified-before-amendment-{previous_hash}.json'
    for row_id in proposals:
        previous_revision = original.get('exampleRevisions', {}).get(row_id, 1)
        updated.setdefault('exampleRevisions', {})[row_id] = previous_revision + 1
        updated.setdefault('exampleHistory', {}).setdefault(row_id, []).append({
            'exampleRevision': previous_revision, 'receiptFile': archive.name,
            'receiptSHA256': previous_hash, 'rowSHA256': full.value_sha(current[row_id])})
    updated['amendments'] = history + [{'serial': serial, 'kind': KIND, 'queueSHA256': queue_sha,
        'previousReceiptSHA256': previous_hash, 'previousReceipt': archive.name, 'rowIds': list(proposals),
        'authorModel': AUTHOR_MODEL, 'reviewModel': REVIEW_MODEL, 'requests': requests}]
    require_idle(work)
    if final.read_bytes() != original_bytes:
        raise ValueError('Accepted receipt changed during explicit replacement review')
    if archive.exists():
        if archive.read_bytes() != original_bytes:
            raise ValueError('Existing replacement history archive differs')
    else:
        # Exclusive creation preserves the original byte representation.
        with archive.open('xb') as output:
            output.write(original_bytes)
    full.verify_receipt(updated, inputs, folder)
    if final.read_bytes() != original_bytes:
        raise ValueError('Accepted receipt changed before replacement commit')
    full.atomic_json(final, updated)
    return {'batch': index, 'replacedRows': len(proposals), 'reviews': len(reviews),
            'exampleRevisions': {key: updated['exampleRevisions'][key] for key in proposals}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--queue', type=Path, required=True)
    parser.add_argument('--work', type=Path, default=full.WORK)
    parser.add_argument('--timeout', type=int, default=2400)
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args(argv)
    require_idle(args.work)
    input_path = args.work / 'input.json'
    snapshot = full.read(input_path)
    full.validate_snapshot(snapshot)
    queue = full.read(args.queue)
    if (queue.get('version') != 1 or queue.get('kind') != KIND
            or queue.get('inputSHA256') != full.file_sha(input_path)
            or not isinstance(queue.get('corrections'), list) or not queue['corrections']):
        raise ValueError('Expected an explicitly source-bound example-replacement-v1 queue')
    locations = {row['rowId']: i // snapshot['batchSize'] + 1 for i, row in enumerate(snapshot['rows'])}
    grouped, seen = {}, set()
    for change in queue['corrections']:
        row_id = change.get('rowId')
        if row_id not in locations or row_id in seen:
            raise ValueError('Unknown or duplicate replacement target')
        seen.add(row_id)
        grouped.setdefault(locations[row_id], []).append(change)
    for index, changes in sorted(grouped.items()):
        start = (index - 1) * snapshot['batchSize']
        print(full.json.dumps(replace_batch(index, snapshot['rows'][start:start + snapshot['batchSize']],
            changes, args.timeout, args.work, kind=queue['kind'])), flush=True)
    if args.publish:
        if args.work.resolve() != full.WORK.resolve():
            raise ValueError('Publication must use the configured exact source workspace')
        require_idle(args.work)
        full.publish(partial=full.status()['verifiedRows'] != snapshot['targetRows'])
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

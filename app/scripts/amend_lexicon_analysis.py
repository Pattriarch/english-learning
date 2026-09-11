"""Independently review targeted editorial amendments without losing prior evidence.

Run after the bulk coordinator finishes. Queue changes bind an exact accepted row
hash; unchanged rows keep their original receipts and requests.
"""
from __future__ import annotations

import argparse
import copy
from pathlib import Path

import enrich_lexicon as full


def amend_batch(index, inputs, changes, timeout, work):
    folder = work / 'batches' / f'{index:04}'
    final = folder / 'verified.json'
    original = full.read(final)
    full.verify_receipt(original, inputs, folder)
    queue_sha = full.value_sha(changes)
    if original.get('amendments') and original['amendments'][-1].get('queueSHA256') == queue_sha:
        return {'batch': index, 'amendedRows': len(changes), 'status': 'resumed'}
    current = {row['rowId']: row for row in original['rows']}
    by_source = {row['rowId']: row for row in inputs}
    proposed, concerns = {}, {}
    for change in changes:
        row_id = change['rowId']
        if row_id not in current or row_id in proposed:
            raise ValueError('Unknown or repeated amendment row')
        if change.get('beforeSHA256') != full.value_sha(current[row_id]):
            raise ValueError('Amendment targets a different accepted row: ' + row_id)
        patch = change.get('changes')
        allowed = set(full.ROW_SCHEMA['properties']) - {'rowId', 'action', 'en', 'replacementReason'}
        if not isinstance(patch, dict) or not patch or not patch.keys() <= allowed:
            raise ValueError('Amendment may update guidance, not silently replace example identity')
        proposed[row_id] = {**copy.deepcopy(current[row_id]), **copy.deepcopy(patch)}
        if proposed[row_id] == current[row_id]:
            raise ValueError('Unchanged amendment')
        concerns[row_id] = str(change.get('reason', 'Editorial correction'))
    full.validate_rows(list(proposed.values()), [by_source[key] for key in proposed])
    # A stable number lets a interrupted amendment resume its bound review calls.
    history = original.get('amendments', [])
    serial = len(history) + 1
    pending = dict(proposed)
    accepted, reviews = {}, []
    for iteration in range(1, 7):
        sources = [by_source[key] for key in pending]
        path = folder / f'amendment-{serial:04}-review-{iteration}.json'
        result = full.cached_call(path, full.REVIEW_PROMPT,
            {'sources': sources, 'proposedRows': list(pending.values()),
             'editorialConcerns': {key: concerns[key] for key in pending}},
            full.REVIEW_SCHEMA, timeout)
        checked = result['checkedRowIds']
        if len(checked) != len(pending) or set(checked) != set(pending) or result['blocked']:
            raise ValueError('Incomplete or blocked amendment review')
        corrections = {row['rowId']: row for row in result['corrections']}
        if len(corrections) != len(result['corrections']) or not corrections.keys() <= pending.keys():
            raise ValueError('Invalid amendment correction IDs')
        corrections = {key: row for key, row in corrections.items() if row != pending[key]}
        record = {'file': path.name, 'sha256': full.file_sha(path),
                  'requestSHA256': full.file_sha(path.with_suffix('.request.json')),
                  'iteration': iteration}
        reviews.append(record)
        for key in pending.keys() - corrections.keys():
            accepted[key] = {'outputSHA256': full.value_sha(pending[key]), **record}
        proposed.update(corrections)
        full.validate_rows(list(proposed.values()), [by_source[key] for key in proposed])
        # Source replacement requires a distinct publication workflow, so a
        # reviewer cannot silently turn an editorial fix into a different task.
        for key, row in proposed.items():
            if any(row[field] != current[key][field] for field in ['rowId', 'action', 'en', 'replacementReason']):
                raise ValueError('Review requested a different example; prepare an explicit replacement')
        if not corrections:
            break
        pending = corrections
    else:
        raise ValueError('Amendment still changing after six reviews')
    updated = copy.deepcopy(original)
    updated['rows'] = [proposed.get(row['rowId'], row) for row in original['rows']]
    updated['rowsSHA256'] = full.value_sha(updated['rows'])
    updated['accepted'].update(accepted)
    updated['reviews'].extend(reviews)
    previous_hash = full.file_sha(final)
    archive = folder / f'verified-before-amendment-{previous_hash}.json'
    updated['amendments'] = history + [{'serial': serial,
        'queueSHA256': queue_sha,
        'previousReceiptSHA256': previous_hash, 'previousReceipt': archive.name,
        'rowIds': list(proposed), 'concerns': concerns}]
    full.verify_receipt(updated, inputs, folder)
    if not archive.exists():
        archive.write_bytes(final.read_bytes())
    elif full.file_sha(archive) != previous_hash:
        raise ValueError('Amendment history archive changed')
    full.atomic_json(final, updated)
    return {'batch': index, 'amendedRows': len(proposed), 'reviews': len(reviews)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--queue', type=Path, required=True)
    parser.add_argument('--work', type=Path, default=full.WORK)
    parser.add_argument('--timeout', type=int, default=2400)
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args(argv)
    status = args.work / 'run-status.json'
    if status.exists() and full.read(status).get('state') in {'running', 'pausing', 'provider-limited'}:
        raise ValueError('Wait for the bulk coordinator to finish before amending its receipts')
    snapshot = full.read(args.work / 'input.json')
    full.validate_snapshot(snapshot)
    queue = full.read(args.queue)
    if queue.get('version') != 1 or not queue.get('corrections'):
        raise ValueError('Expected a nonempty versioned editorial queue')
    locations = {row['rowId']: i // snapshot['batchSize'] + 1 for i, row in enumerate(snapshot['rows'])}
    grouped, seen = {}, set()
    for change in queue['corrections']:
        key = change['rowId']
        if key not in locations or key in seen:
            raise ValueError('Unknown or duplicate correction target')
        seen.add(key)
        grouped.setdefault(locations[key], []).append(change)
    for index, changes in sorted(grouped.items()):
        offset = (index - 1) * snapshot['batchSize']
        print(full.json.dumps(amend_batch(index, snapshot['rows'][offset:offset+snapshot['batchSize']],
                                         changes, args.timeout, args.work)), flush=True)
    if args.publish:
        if args.work.resolve() != full.WORK.resolve():
            raise ValueError('Publication must use the configured exact source workspace')
        full.publish(partial=full.status()['verifiedRows'] != snapshot['targetRows'])
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

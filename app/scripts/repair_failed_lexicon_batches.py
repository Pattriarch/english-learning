"""Stage explicitly authored alternatives for semantically blocked source rows.

Run only after the generation coordinator has finished. Original source records
remain archived by ID. New English contexts are independently reviewed when the
affected completion batches resume; no unchecked definition is published here.
"""
import argparse
import hashlib

from build_context_lexicon import atomic_json, target_spans, file_sha
from complete_context_lexicon import BANK, WORK, read, fingerprint, input_row, apply_selection_repairs, value_sha


def reuse_partial_reviews(folder, draft, existing, replacements, revision):
    """Recover explicit acceptance of unchanged rows from an incomplete batch."""
    inherited = {row_id: receipt for row_id, receipt in draft.get('inheritedReviews', {}).items()
                 if row_id not in replacements}
    prefix = 'review' if draft.get('inputRevision', 1) == 1 else 'review-r'+str(draft['inputRevision'])
    accepted = {}
    for number in range(1, 6):
        review_path = folder / f'{prefix}-{number}.json'
        if not review_path.exists():
            break
        review = read(review_path)
        current = {row['rowId']: row for row in draft['rows']}
        checked = review['checkedRowIds']
        if len(checked) != len(set(checked)) or not set(checked) <= current.keys():
            raise ValueError('Cannot reuse a review with invalid row identities')
        fixes = {row['rowId']: row for row in review['corrections']}
        blocked = {row['rowId'] for row in review['blocked']}
        for row_id in checked:
            if row_id in fixes or row_id in blocked:
                accepted.pop(row_id, None)
            else:
                accepted[row_id] = {'row': current[row_id], 'reviewPasses': number,
                    'reviewFile': review_path.name, 'reviewSHA256': file_sha(review_path)}
        draft['rows'] = [fixes.get(row['rowId'], row) for row in draft['rows']]
    accepted = {row_id: receipt for row_id, receipt in accepted.items() if row_id not in replacements}
    if not accepted:
        return inherited
    receipt_path = folder / f'partial-accepted-before-repair-{revision}.json'
    atomic_json(receipt_path, {'method': 'Explicitly checked rows without correction or block in independent semantic review',
                               'accepted': accepted})
    return {**inherited, **{row_id: {'inputSHA256': value_sha(existing[row_id]), 'outputSHA256': value_sha(receipt['row']),
                    'receiptFile': receipt_path.name, 'receiptSHA256': file_sha(receipt_path),
                    'reviewPasses': receipt['reviewPasses']} for row_id, receipt in accepted.items()}}


def stage(path):
    specs = read(path)
    snapshot = read(WORK / 'input.json')
    repairs = read(WORK / 'prepared-selection-repairs.json')
    repairs['source']['title'] = 'Context selection corrections and original study examples'
    repairs['source']['reviewMethod'] = ('Full-bank Unicode boundary audit; English-study suitability classification of the targeted completion scope; '
        'new English, Russian translations and selected meanings receive independent AI semantic review; limited AI peer samples are recorded separately')
    document = apply_selection_repairs(read(BANK / 'entries.json'), repairs)
    by_id = {e['id']: e for e in document['entries']}
    existing = {r['rowId']: r for r in snapshot['rows']}
    if len({s['rowId'] for s in specs}) != len(specs):
        raise ValueError('Duplicate repair ID')
    replacements = {}
    for spec in specs:
        old_row = existing[spec['rowId']]
        entry = by_id[old_row['entryId']]
        old_context = next(c for c in entry['contexts'] if c['id'] == old_row['contextId'])
        spans = target_spans(spec['en'], entry['word'], spec.get('targetForms'))
        if not spans or len(spec['reason']) < 20:
            raise ValueError('Repair needs an actual target and explanation')
        source = repairs['source']
        context = {'id': entry['id']+'-context-repair-'+hashlib.sha256(spec['rowId'].encode()).hexdigest()[:10],
            'en': spec['en'], 'ru': None, 'targetSpans': spans, 'senseId': None,
            'variety': 'unverified', 'source': {'sourceId': source['id'], 'license': source['license'],
                'attribution': source['author'], 'kind': 'original-editorial'},
            'alignment': 'Original replacement example; independent semantic review pending', 'quality': 'editorial-draft'}
        if spec.get('targetForms'):
            context['targetForms'] = spec['targetForms']
        addition = {'entryId': entry['id'], 'replacesContextId': old_context['id'], 'reason': spec['reason'], 'context': context}
        if spec.get('peerReviewNote'):
            addition['peerReviewNote'] = spec['peerReviewNote']
        repairs['additionalContexts'].append(addition)
        repairs['exclusions'].append({'entryId': entry['id'], 'contextId': old_context['id'],
            'baseSHA256': fingerprint(entry, old_context), 'reason': spec['reason']})
        replacements[spec['rowId']] = input_row(entry, context)
    current_revision = snapshot.get('revision', 1)
    history = WORK / f'input-revision-{current_revision}.json'
    if history.exists():
        raise ValueError('Input history would be overwritten')
    atomic_json(history, snapshot)
    snapshot['rows'] = [replacements.get(r['rowId'], r) for r in snapshot['rows']]
    snapshot['revision'] = current_revision+1
    snapshot['revisionReason'] = 'Semantically blocked source examples retained outside study; individually authored alternatives require fresh review.'
    for folder in (WORK / 'batches').iterdir():
        draft_path = folder / 'draft.json'
        if not draft_path.exists():
            continue
        draft = read(draft_path)
        if not any(r['rowId'] in replacements for r in draft['rows']):
            continue
        verified_path = folder / 'verified.json'
        inherited = {}
        if verified_path.exists():
            accepted = read(verified_path)
            archived = folder / f'verified-before-repair-{current_revision}.json'
            if archived.exists() or not verified_path.resolve().is_relative_to(WORK.resolve()) or not archived.resolve().is_relative_to(WORK.resolve()):
                raise ValueError('Cannot safely archive verified checkpoint')
            # A new English example needs a fresh review; preserve the old receipt.
            verified_path.rename(archived)
            draft['rows'] = accepted['rows']
            for row in draft['rows']:
                if row['rowId'] not in replacements:
                    inherited[row['rowId']] = {'inputSHA256': value_sha(existing[row['rowId']]), 'outputSHA256': value_sha(row),
                        'receiptFile': archived.name, 'receiptSHA256': file_sha(archived),
                        'reviewPasses': accepted.get('rowReviewPasses', {}).get(row['rowId'], accepted['reviewPasses'])}
        atomic_json(folder / f'draft-before-repair-{current_revision}.json', draft)
        if not inherited:
            inherited = reuse_partial_reviews(folder, draft, existing, replacements, current_revision)
        draft['rows'] = [r for r in draft['rows'] if r['rowId'] not in replacements]
        draft['inputRevision'] = current_revision+1
        draft['inheritedReviews'] = inherited
        atomic_json(draft_path, draft)
    atomic_json(WORK / 'prepared-selection-repairs.json', repairs)
    atomic_json(WORK / 'input.json', snapshot)
    print({'replacedRows': len(replacements), 'inputRevision': snapshot['revision']})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('specification')
    stage(parser.parse_args().specification)

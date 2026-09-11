"""Batch only newly authored replacement contexts, then attach exact receipts.

This avoids dozens of tiny model calls after source repair. Parent batches keep
unchanged accepted rows. Every new English context still receives independent
drafting and semantic review through the same completion pipeline.
"""
import argparse
import shutil

import complete_context_lexicon as completion
from build_context_lexicon import atomic_json, file_sha


def run(workers, timeout):
    parent = completion.WORK
    snapshot = completion.read(parent / 'input.json')
    round_dir = parent / ('replacement-round-' + str(snapshot['revision']))
    stage = round_dir / 'input.json'
    parent_hash = file_sha(parent / 'input.json')
    if not stage.exists():
        pending = []
        size = snapshot['batchSize']
        for index in range(0, len(snapshot['rows']), size):
            folder = parent / 'batches' / f'{index//size+1:03}'
            draft = completion.read(folder / 'draft.json')
            present = {row['rowId'] for row in draft['rows']}
            pending.extend(row for row in snapshot['rows'][index:index+size] if row['rowId'] not in present)
        atomic_json(stage, {'parentInputSHA256': parent_hash, 'batchSize': 48, 'rows': pending})
    round_input = completion.read(stage)
    if round_input['parentInputSHA256'] != parent_hash:
        raise ValueError('Parent input changed during replacement review')
    if not round_input['rows']:
        print({'newContexts': 0})
        return
    completion.WORK = round_dir
    try:
        completion.generate(workers, timeout, 0)
    finally:
        completion.WORK = parent
    if file_sha(parent / 'input.json') != parent_hash:
        raise ValueError('Parent input changed during replacement review')
    inputs = {row['rowId']: row for row in round_input['rows']}
    outputs = {}
    for path in sorted((round_dir / 'batches').glob('*/verified.json')):
        receipt = completion.read(path)
        for row in receipt['rows']:
            if row['rowId'] in outputs:
                raise ValueError('Duplicate replacement output')
            outputs[row['rowId']] = (row, path, receipt.get('rowReviewPasses', {}).get(row['rowId'], receipt['reviewPasses']))
    if outputs.keys() != inputs.keys():
        raise ValueError('Missing replacement review')
    size = snapshot['batchSize']
    attached = 0
    for index in range(0, len(snapshot['rows']), size):
        folder = parent / 'batches' / f'{index//size+1:03}'
        draft_path = folder / 'draft.json'
        draft = completion.read(draft_path)
        present = {row['rowId'] for row in draft['rows']}
        inherited = draft.setdefault('inheritedReviews', {})
        for source in snapshot['rows'][index:index+size]:
            if source['rowId'] not in outputs:
                continue
            row, receipt_path, passes = outputs[source['rowId']]
            if completion.value_sha(source) != completion.value_sha(inputs[source['rowId']]):
                raise ValueError('Replacement input changed')
            copied = folder / f'replacement-round-{snapshot["revision"]}-batch-{receipt_path.parent.name}.json'
            shutil.copy2(receipt_path, copied)
            if row['rowId'] not in present:
                draft['rows'].append(row)
                present.add(row['rowId'])
            elif next(item for item in draft['rows'] if item['rowId'] == row['rowId']) != row:
                raise ValueError('Replacement output was independently changed')
            inherited[row['rowId']] = {'inputSHA256': completion.value_sha(source),
                'outputSHA256': completion.value_sha(row), 'receiptFile': copied.name,
                'receiptSHA256': file_sha(copied), 'reviewPasses': passes}
            attached += 1
        atomic_json(draft_path, draft)
    print({'newContextsWithIndependentReview': attached, 'round': snapshot['revision']}, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=4)
    parser.add_argument('--timeout', type=int, default=900)
    args = parser.parse_args()
    run(args.workers, args.timeout)

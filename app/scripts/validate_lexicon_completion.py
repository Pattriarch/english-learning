"""Read-only publication audit against the exact pre-completion source bank.

Usage: python app/scripts/validate_lexicon_completion.py --baseline <entries.json>
The baseline is a local source snapshot, not learner data. This checks retention
and declared coverage; structural validation does not imply semantic certification.
"""
import argparse
import json
from pathlib import Path

from build_context_lexicon import file_sha, validate_entries
from complete_context_lexicon import BANK, inventory, read


def audit(baseline_path, bank=BANK):
    baseline = read(baseline_path)
    current = read(bank / 'entries.json')
    overlay = read(bank / 'editorial-completion.json')
    repairs = read(bank / 'token-selection-repairs.json')
    coverage = read(bank / 'coverage.json')
    sources = read(bank / 'sources.json')['sources']
    errors = []
    if file_sha(baseline_path) != overlay['originalBankSHA256']:
        errors.append('Baseline SHA does not match the editorial input snapshot')
    if file_sha(bank / 'entries.json') != coverage['outputSHA256']:
        errors.append('Coverage SHA does not identify the published bank')
    before = {e['id']: e for e in baseline['entries']}
    after = {e['id']: e for e in current['entries']}
    if before.keys() != after.keys():
        errors.append('Stable entry IDs were added or removed')
    old_context_count = 0
    for entry_id, original in before.items():
        entry = after.get(entry_id)
        if not entry:
            continue
        for key in ('word', 'rank', 'memberships', 'cefr'):
            if entry.get(key) != original.get(key):
                errors.append(f'{entry_id}: source {key} changed')
        contexts = {c['id']: c for c in entry['contexts']}
        old_context_count += len(original['contexts'])
        for context in original['contexts']:
            retained = contexts.get(context['id'])
            if not retained:
                errors.append(f'{entry_id}: source context removed: {context["id"]}')
                continue
            for key in ('en', 'source', 'targetSpans'):
                if retained.get(key) != context.get(key):
                    errors.append(f'{entry_id}:{context["id"]}: source {key} changed')
            if context.get('ru') and retained.get('ru') != context['ru']:
                if retained.get('originalTranslation') != {'ru': context['ru'], 'source': context.get('translationSource')}:
                    errors.append(f'{entry_id}:{context["id"]}: changed translation was not retained')
        senses = {s['id']: s for s in entry['senses']}
        for sense in original['senses']:
            if senses.get(sense['id']) != sense:
                errors.append(f'{entry_id}: original reference sense changed: {sense["id"]}')
        if not any(not c.get('excludedFromStudy') for c in entry['contexts']):
            errors.append(f'{entry_id}: no active study context')
        if not any(s.get('definition') for s in entry['senses']):
            errors.append(f'{entry_id}: no reference definition')
    for row in overlay['entries']:
        entry = after[row['entryId']]
        context = next(c for c in entry['contexts'] if c['id'] == row['contextId'])
        if context.get('excludedFromStudy') or context.get('quality') != 'ai-context-reviewed' or context.get('ru') != row['ru']:
            errors.append(f'{row["rowId"]}: reviewed row was not published as active material')
    for addition in repairs['additionalContexts']:
        entry = after[addition['entryId']]
        context = next(c for c in entry['contexts'] if c['id'] == addition['context']['id'])
        if context.get('quality') != 'ai-context-reviewed':
            errors.append(f'{entry["id"]}: replacement lacks independent review')
    counts = inventory(current)
    if counts['studyContextsWithoutRussian']:
        errors.append('Active study contexts still lack Russian translations')
    for field in ('aiReviewedContexts', 'contextsWithoutRussian', 'studyContextsWithoutRussian',
                  'contextsWithoutSelectedMeaning', 'studyContextsWithoutSelectedMeaning',
                  'entriesWithTranslatedSelectedMeaning', 'entriesWithoutStudyContext',
                  'excludedSourceContexts', 'studyContexts'):
        if coverage.get(field) != counts[field]:
            errors.append('Coverage count does not match the bank: ' + field)
    validate_entries(current, sources)
    return {'errors': errors, 'sourceEntryIDsRetained': len(before),
            'sourceContextIDsEnglishSpansAndAttributionRetained': old_context_count,
            'reviewedCompletionRows': len(overlay['entries']), 'newContextAdditions': len(repairs['additionalContexts']),
            'outputSHA256': coverage['outputSHA256'], **counts}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', required=True, type=Path)
    parser.add_argument('--bank', type=Path, default=BANK)
    args = parser.parse_args()
    result = audit(args.baseline, args.bank)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(1 if result['errors'] else 0)

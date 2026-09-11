# Context dictionary completion: editorial method and evidence

This document describes the completion work begun on 10 September 2026. The live counts and the exact published `entries.json` hash are in `content/lexicon/coverage.json`.

## Published result — 11 September 2026

| Measure | Published value |
| --- | ---: |
| Stable source headword records | 10,188 |
| Entries with at least one active Russian-translated context and a reference definition | 10,188 |
| Active contexts / preserved source archives | 17,735 / 309 |
| Total contexts, including archives | 18,044 |
| Newly AI-reviewed contexts / affected entries | 2,240 / 1,782 |
| Existing editorial contexts / entries, counted separately | 208 / 208 |
| Entries with an active translated context and selected meaning | 1,990 |
| Active contexts still without a selected meaning | 15,287 |
| Active contexts without Russian text | 0 |
| Archived original contexts without Russian text | 199 |
| Verified CEFR labels / word images | 0 / 0 |

The remaining 8,198 entries are available as contextual imports with reference definitions; they are not represented as fully prepared meaning-specific lessons. The app's prepared filter selects the 1,990 entries with actual editorial or AI-reviewed context-to-meaning links. Existing editorial status does not establish human review. The 36 separately authored American phrase cards and their scene assets are not included in these word counts.

Every required headword in the published NGSL 1.2 (2,809), NGSL-GR 1.0 (5,050), NGSL-Spoken 1.2 (721), supplement (52), and NAWL 1.2 (957) has a context and Russian translation. These lists overlap; their totals must not be added together. This is source-list coverage, not a claim to every English word or a verified A1–C2 ranking for each word.

The source build retained all 10,188 original entry IDs and all 17,745 original context IDs, English texts, selection spans and source attributions. It preserved all original reference senses, rank/list metadata and any corrected original Russian translation. It added 299 contexts: 3 replacements for invalid token selections and 296 replacements within the completion scope. None of the 309 excluded source contexts was deleted.

Two independent AI peer samples inspected 35 and 20 proposed English replacements. Three examples were revised explicitly: emergence, flap and ante. Fresh Russian translations, parts of speech and meanings for all 295 revision-3 replacements were drafted and independently reviewed in 7 compact batches. A final single-row revision replaced the component *plasma* in *plasma membrane* with a transparent physical-state use after repeated component/compound ambiguity. Its meaning was checked against the [US Department of Energy's plasma explanation](https://www.energy.gov/science/doe-explainsplasma); the original compound sentence is retained and is not declared grammatically wrong. This last new example also passed separate drafting and independent review. No human review of the whole bank is claimed.

Published `entries.json` SHA-256: `71c53166854828fb8c9f02b7482a87963ba3371084625bf0b3eae6b60c097c60` (70,229,225 bytes). The full read-only retention/coverage audit returned zero errors, and 29 Python contract tests passed. Rebuilding a separate copy of the already published bank produced byte-identical `entries.json` with the same SHA and passed the retention audit again. `content/lexicon/completion-release.json` retains compact publication results and hashes of the exact review checkpoints; private CLI diagnostics are kept outside Git.

Final integration was verified on the running application: `/api/lexicon?prepared=1` returns 2,026 prepared entries (1,990 words plus 36 phrases), matching the browser filter. The `snag` page opens its reviewed sweater/nail example with Russian text, explanation and linked definition; its excluded original is not an active learning context. Browser error logs were empty during this check. The root agent independently reran the full source-retention validator with zero errors. The updated interface passed all 233 JavaScript tests; `go test -mod=readonly ./...` and `go vet -mod=readonly ./...` passed. Updating the running server preserved the learner's progress bytes and created a local backup; the dictionary publication itself only replaces curriculum data.

## Baseline and scope

The input had 10,188 stable source headword records, 17,745 context records (13,813 distinct English texts), 1,073 entries without any Russian context, and 708 without a definition. The two missing-field groups did not overlap. There were 1,531 untranslated dictionary examples, because many entries have two examples.

The 208 preexisting `context-reviewed` entries are counted separately from the new AI review. An editorial status alone does not establish that a human performed the review.

The completion targets every untranslated study context and a selected context for every entry without a definition. It does not silently certify the remaining imported contexts. Initially 16,006 contexts had no selected sense. Every entry had `cefr:null`; eight source records lacked a verified frequency rank. These unknown values are preserved. A count of source headwords is not a count of independently mastered lemmas or proof of CEFR attainment.

## Reproducible review

`scripts/complete_context_lexicon.py` prepares an input snapshot containing the exact English text, target spans, existing translation, source definitions, and attribution. The authenticated local Codex CLI receives bounded batches in isolated temporary directories with shell/network tools disabled. No learner progress, profile data, servers, or source archives are modified by model calls.

Each draft receives a separate semantic review covering translation, the precise highlighted meaning, part of speech, register, and source defects. Corrections receive another independent review. A review that cannot establish the intended meaning blocks that batch. A `verified.json` receipt is created only after the reviewer accepts the current rows without further corrections. The receipts describe AI review; they are not represented as full human review.

`scripts/audit_lexicon_study_examples.py` classifies reported source issues to decide whether the English example is suitable for learning. An independently accepted row with no source issues reuses that result, because the semantic-review contract already checks for flawed English and omitted source issues. A flawed imported gloss does not automatically invalidate an otherwise correct example. A genuinely broken English construction receives a new original example, followed by the same semantic-review pipeline. Correct British, formal, or uncommon expressions can remain with a label. If the original use has no legitimate recoverable meaning, the repair explicitly records that problem and introduces a separate attested use rather than pretending to preserve an invented sense.

After a repair, unchanged input/output rows reuse the exact prior receipt by hash. Only the changed examples receive another model review. The originating review iteration and archived receipt filename/hash preserve the distinction; a whole batch is not repeatedly certified merely because one sentence changed. The legacy field `reviewPasses` means the final review iteration of the originating accepted checkpoint, not the number of different reviewers or human reviews; unchanged rows may have been accepted earlier in that checkpoint.

During the final partial repair, a receipt-merge defect caused an unnecessary fresh review of 45 unchanged rows. Those completed review receipts were retained. The helper now preserves the earlier receipts when merging a later partial repair; a regression test reproduces this case. No rejected or unchecked correction was promoted by that fix.

`review_lexicon_replacements.py` groups the newly authored examples into normal-sized review batches and attaches their exact independent receipts back to the original batches. An unchanged row accepted within a partially blocked batch can also retain that explicit acceptance. A correction that was not independently rechecked cannot inherit acceptance. No empty model review is run when every row already has a verified receipt.

New explanatory definitions follow American spelling. A narrow editorial normalization logs every before/after change in the completion overlay. It leaves source quotations, imported definitions, source-issue quotations, proper names, and definitions of spelling variants unchanged. Ambiguous forms such as the noun plural *analyses* are not automatically converted.

## Source retention and known selection defects

A complete Unicode-boundary audit found 12 source contexts whose old ASCII-based selection highlighted fragments inside words containing diacritics: for example, `mi` inside `Sámi` and `rep` inside `República`. The ordinary-word entry `wow` also selected the unrelated game abbreviation `WoW`. Original source records and context IDs are retained, but `excludedFromStudy:true` prevents their use in cards or practice. Each exclusion carries an attributed reason. Every entry must still have at least one active context.

The current importer matches complete Unicode tokens. Its selection cache has an explicit new version. Rebuilding retains the published context IDs even when an improved selector no longer chooses them; a replacement enters through the reviewed overlay. This also prevents newly selected untranslated dictionary fallbacks from quietly entering a completed entry. If a refreshed source has the same context ID but changed content, the overlay hash still requires a fresh review. The validated publication rejects an active Tatoeba context whose spans differ from a whole-headword match. Old invalid contexts remain readable as historical evidence; they do not become legitimate examples merely because their UTF-16 offsets are well formed.

For entries with no suitable existing alternative, replacement examples are separately attributed. The `mar` replacement initially uses an already imported Wiktionary example. Original `rep` and letter-name-plural `es` examples use meanings checked against [Merriam-Webster's rep entry](https://www.merriam-webster.com/dictionary/rep) and [es entry](https://www.merriam-webster.com/dictionary/es). The latter remains explicitly marked as a letter-name plural, not an independent everyday lemma. Subsequent context exclusions and replacements are individually listed in `token-selection-repairs.json`.

An excluded malformed source example can retain `ru:null` rather than acquire a fabricated translation. `studyContextsWithoutRussian` measures active learning material; `contextsWithoutRussian` also includes preserved source archives. These quantities must not be conflated.

## Publication and rebuild

The source imports remain attributed to their actual authors. New definitions have editorial AI-assisted provenance. Translations of imported examples retain the original source licence in their own `translationSource.license` and name the English source in `derivedFrom`. Corrected existing translations preserve the previous text and attribution in `originalTranslation`.

Entry IDs, existing context IDs, source English text, memberships, and rank fields are retained. Editorial additions receive distinct sense/context IDs. The overlay checks a hash of entry identity, English context, source attribution and target spans before applying. Changed source English or an independently edited translation requires a new review. The ordinary source build reapplies `token-selection-repairs.json` and `editorial-completion.json`, so rebuilding does not erase completed editorial work.

Typical commands (run from repository root with the bundled Python runtime):

```text
python app/scripts/complete_context_lexicon.py --prepare
python app/scripts/complete_context_lexicon.py --generate --workers 4
python app/scripts/audit_lexicon_study_examples.py --workers 4
python app/scripts/repair_failed_lexicon_batches.py <reviewed-repair-specification.json>
python app/scripts/review_lexicon_replacements.py --workers 4
python app/scripts/complete_context_lexicon.py --generate --workers 4
python app/scripts/complete_context_lexicon.py --publish
```

`--publish` prepares validated output in ignored `data/lexicon-completion/`; it does not replace the live bank. The approved overlay and selection-repair documents are then copied to `content/lexicon/`, and `build_context_lexicon.py --build` publishes the reproducible bank and matching coverage/source receipts. Input revisions and superseded review receipts are preserved, never relabelled as reviews of a different English example.

`validate_lexicon_completion.py --baseline <original-entries.json>` provides a read-only comparison against the exact pre-completion bank identified by the overlay's source SHA. It checks every original entry ID, context ID, English sentence, selection span, source attribution, reference sense, rank and list membership. It also checks that changed existing translations retain their original text/source, every active context has Russian text, every new replacement has an independent AI review, and all published coverage figures and the output SHA agree. It intentionally does not treat an unrelated reference definition as a selected context meaning.

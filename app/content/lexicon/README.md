# Context lexicon — data contract and attribution

Initial publication: 2026-09-10. `entries.json` is the word bank; `american-phrases.json` and `scenes.json` are separately authored additions. Word counts do not include phrases and do not measure CEFR attainment.

Completion release, 2026-09-11: 10,188 source headword records, each with a reference definition and a Russian-translated active example. The bank contains 17,735 active contexts and 309 preserved source archives. Independent AI review covers 2,240 contexts in 1,782 entries, separately from the 208 existing editorial entries. Thus 1,990 words have an active translated example with a selected meaning; the remaining 8,198 words are contextual imports with reference definitions. The app's prepared filter distinguishes these groups. No complete CEFR classification or image collection is claimed. Exact hashes and review boundaries are recorded in `completion-release.json` and `coverage.json`.

The initial bank contains 10,000 distinct source headwords, 17,557 English contexts, 8,927 words with a Russian context, and 9,292 words with at least one imported or editorial definition. Only 20 contexts were editorially reviewed at this publication. Subsequent figures belong to `coverage.json`, not this dated snapshot. NGSL 1.2, Spoken and supplementary lists are complete as contextual imports. The remaining GR/NAWL requirements initially comprise 188 distinct headwords; `required-gaps.json` records each missing item and the exact selection criteria.

## Reproduce

Run with Python 3 and openpyxl available:

```text
python app/scripts/build_context_lexicon.py --download
python app/scripts/build_context_lexicon.py --build
python -m unittest discover -s app/scripts -p test_build_context_lexicon.py -v
```

Downloads total about 71.6 MB compressed/source data. Exact sizes, retrieval dates, final URLs and SHA256 receipts are in `sources.json`. Archives and derived selection caches live in ignored `app/data/lexicon-sources/`. Cached archives are checked against their receipts. Source refresh is explicit (`--download --refresh-sources`); it may change imported text. No learner progress or lesson caches are touched.

Files are replaced atomically. `coverage.outputSHA256` identifies the corresponding `entries.json`; consumers reading different files during replacement can compare this digest. `pilot.json` is a separate 20-entry demonstration of reviewed context-to-meaning links. IDs are derived from normalized headwords and remain stable across order changes. Existing published IDs should be retained when adding required vocabulary.

## Contract

- `rank` retains the named source metric. `RawFreq_Rank`, SFI rank and graded-reader sequence are different measures. A null rank remains unknown. `cefr:null` means no verified CEFR mapping, not A1 or C2.
- `memberships` records every applicable required source list; overlapping lists must not be added together to count unique vocabulary.
- `contexts[].targetSpans` use UTF-16 code units, compatible with JavaScript `String.slice`. They point to actual surface forms. Exact matches do not automatically conflate inflections, words, senses or families.
- `contexts[].ru` can be null in preserved source archives. In the completed release every active study context has Russian text. Each translation carries its own `translationSource`; English and Russian authors need not be the same person.
- A Tatoeba context has `senseId:null` until meaning is reviewed. Dictionary senses are reference information, not automatically translations of that context. A dictionary's own nested example can retain its source sense, labelled `source-linked-context` and unreviewed.
- `context-reviewed` concerns the explicitly linked original context, Russian translation and selected sense only. Other imported senses in that entry are still unverified. `sourceIssues` preserve identified source errors instead of teaching them as correct definitions.
- `ai-context-reviewed` records a separate AI drafting and semantic-review workflow for the named context. Its `completionReview` receipt and selected editorial sense must agree. This status does not assert a human review of the entire entry or certify unrelated imported examples.
- `excludedFromStudy:true` retains a defective source context and its stable ID for history, with an attributed `exclusionReason`. It must not be shown as a card or practice prompt. Every entry retains at least one active context. `studyContextsWithoutRussian` excludes these archives; the raw `contextsWithoutRussian` count includes them.
- `targetVariety:en-US` is the learning target. Imported contexts and untagged IPA are not declared American. Pronunciation regional tags are retained literally; a neighboring audio filename is not evidence for an IPA variant.
- Editorial `collocations` are combinations used in the cited scenario, not frequency claims. Topics and images stay empty without evidence. Original practice prompts require production in a situation, not multiple choice.

## Attribution and licences

`sources.json` and the attribution on every context/sense must travel with exports. Imported material does not become original project content through JSON formatting, filtering or translation alignment.

| Material | Attribution and licence | Modifications here |
| --- | --- | --- |
| NGSL/GR/Spoken/supplement/NAWL | Charles Browne, Brent Culligan, Joseph Phillips as applicable; [NGSL official site](https://www.newgeneralservicelist.com/new-general-service-list), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Subset selection, normalized keys, source memberships and source rank fields; no CEFR inference. |
| Tatoeba English and Russian text/links | Individual contributors retained by sentence ID and author; [download terms](https://tatoeba.org/en/downloads), [CC BY 2.0 France](https://creativecommons.org/licenses/by/2.0/fr/) | Sentence selection, direct translation alignment and target spans. Source text itself retained. No audio imported. |
| Simple English Wiktionary through Kaikki/Wiktextract | Simple English Wiktionary contributors; [source copyright page](https://simple.wiktionary.org/wiki/Wiktionary:Copyrights), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [extractor/data documentation](https://kaikki.org/dictionary/rawdata.html) | JSON extraction, filtering of form-only records and externally attributed quotations, consolidation of identical POS/gloss senses with provenance, target spans. Source glosses are imported, not silently rewritten. |
| Editorial scenarios, Russian translations and explanations | English project contributors; `original-project-content` | Written for the project. This tag identifies origin; it does not impose a licence on the entire repository. Imported CC material retains its own attribution and share-alike requirements. |

The MIT licence of Wiktextract covers software, not blanket rights to dictionary content. Externally attributed quotations and audio are not imported under an assumed dictionary licence. The initial bank does not contain scraped Oxford definitions or unlicensed COCA data. Per-source legal pages and receipts are evidence boundaries, not a legal opinion about every possible redistribution.

Detailed source research, corpus-size distinctions and CEFR limitations: `app/docs/CONTEXT-LEXICON-SOURCES-2026-09-10.md`.

The completion/review workflow, Unicode-token corrections, meaning-specific editorial attribution and input-revision safeguards are documented in `app/docs/LEXICON-COMPLETION-2026-09-10.md`. When present, `token-selection-repairs.json` and `editorial-completion.json` are reapplied by the source build. Their original-source hashes prevent a later source refresh from silently attaching old editorial work to different English text.

## Saved feedback after content updates

The lexicon UI saves `lexicon:feedback:<attemptId>` as a normal progress draft, containing a versioned SHA-256 receipt of the exact exercise, level, source context, translation and teaching explanation used for the check. The answer remains in `lexicon:answer:<entryId>:<contextId>`; the full attempt stays in the existing journal. Stable entry/context IDs alone never establish that an older assessment belongs to an updated task. Attempts predating receipts remain visible in history but are not automatically displayed as current feedback. A changed translation also receives a new check request ID. These behaviours are covered by `studio/tests/lexicon-lifecycle.test.mjs`.

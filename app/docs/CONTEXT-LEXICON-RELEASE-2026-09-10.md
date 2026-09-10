# Context lexicon release — 2026-09-10

The published `app/content/lexicon/entries.json` contains **10,188 source-headword records**, 17,745 English contexts and 20,502 distinct sense records. There are Russian contexts for 9,115 records and definitions for 9,480. The remaining 1,073 records have English context only; 708 have no imported/editorial definition. These are explicit data limits, not completed translation or semantic review.

Release SHA256: `0dc07b85915afa20f1f04ec5e3bb4e8f544db75564cdbe0c98ccbb75b29b9aeb`; size 64,951,805 bytes. `coverage.json` records this output digest, publication status and per-list counts. The original 10,000 entry IDs remain; 188 missing core records were added instead of displacing less frequent existing records or learner history.

## Source coverage

| Official source list | Headwords with an English context | With a Russian context |
| --- | ---: | ---: |
| NGSL 1.2 | 2,809 / 2,809 | 2,785 |
| NGSL-Graded Reader 1.0, actual download | 5,050 / 5,050 | 4,875 |
| NGSL-Spoken 1.2 | 721 / 721 | 721 |
| NGSL supplementary headwords | 52 / 52 | 50 |
| NAWL 1.2, actual download | 957 / 957 | 865 |

The lists overlap. A total must use unique IDs rather than sum these rows. The advertised GR “5,000” file actually includes 50 introductory number/calendar items; NAWL 1.2 has 957 entries. All membership records retain the actual source identifier and metric. The separate first 10,000 entries by the old NGSL 31k table's `RawFreq_Rank` still have **1,299 context gaps** under the documented selection criteria. Completion of the required lists is not completion of that different ranked sequence.

Counts refer to source headwords, not independently mastered lemmas: `multi` and `neo` are explicitly marked combining forms and taught through `multilingual` and `neoclassical`. `descendent` and `café` retain marked variant spellings; their presence does not invent extra meanings. The source list's `congratulation` is practiced through the natural form `Congratulations on…`, with its surface relation recorded.

## Editorial reading and corrections

**208** contexts have an original English scenario, original Russian translation, precise selected meaning, explanation, evidenced phrase and a production task. Their English scenarios total 5,194 words. Initial 20 were author-reviewed; the additional 188 were independently read in full:

| File | Records | Independent reviewer |
| --- | ---: | --- |
| `editorial-core-01.json` | 30 | root |
| `editorial-core-02.json` | 30 | root |
| `editorial-core-03.json` | 30 | book_lesson_pipeline |
| `editorial-core-04.json` | 30 | root |
| `editorial-core-05.json` | 30 | book_lesson_pipeline |
| `editorial-core-06.json` | 30 | root |
| `editorial-core-07.json` | 8 | root |

Each review included both meanings, full English/Russian contexts, explanation, phrase and task; file review metadata records approval. Material corrections preserved the distinction between an independently collected dataset and independent reanalysis of the same dataset (`revelation`), and removed a guarantee that random ordering perfectly balances positions (`randomize`). A task referring to an unavailable photograph was made self-contained (`fungus`). Russian wording and the natural technical expression `reviewing a diff` were refined.

**205** reviewed contexts are American-compatible. `enquiry` and `postgraduate` are recognition contexts with `inquiry` and `graduate student` alternatives; `tonne` explicitly explains `metric ton` versus a US ton. `café` is not falsely restricted to British English. Vulgar `fuck up` and `shit` have register labels and neutral rewrite tasks. `primer` distinguishes the usual American introductory-text pronunciation from the paint sense and does not promise that every TTS voice selects the intended pronunciation.

Imported Simple Wiktionary gloss problems for `shareholder` and `fascinate` are preserved with source-issue flags and separate correct editorial senses. The first concern about `stair` was revised after [Merriam-Webster confirmed both uses](https://www.merriam-webster.com/dictionary/stair): a source note distinguishes the flight-of-steps sense from the editorial single-step context without declaring the other sense invalid.

## Validation and publication boundaries

17 regression checks pass, including every published context's sense references, source attribution, Russian attribution, UTF-16 highlight spans, duplicate IDs, rejection of inferred Tatoeba sense links and invented CEFR labels, direct coverage of every required source headword, exclusion of unapproved chunks and retention of published extra IDs. Rebuilding the pilot was executed and verified not to change any byte of live `entries.json`, `sources.json`, `coverage.json` or `required-gaps.json`. Pilot outputs now have separate metadata; downloading sources alone also cannot overwrite the live attribution registry.

`context-reviewed` applies only to the corresponding linked context and editorial sense. Imported definitions elsewhere in the same entry remain unreviewed. Tatoeba examples have `senseId:null` unless specifically reviewed; a source dictionary's own nested example may keep its source sense but is labelled unreviewed. The 17,537 other contexts were formally imported, not all manually read. The collection makes no claim that 10,188 entries establish C1/C2, that all meanings are American, or that every word has an illustration. Root's separately authored American phrase/scenario layer has its own assets and counts.

Source provenance and copyright boundaries are documented in [the source research](CONTEXT-LEXICON-SOURCES-2026-09-10.md) and `app/content/lexicon/README.md`. Ten bounded source downloads total 71,643,597 bytes; their per-file hashes, authors, source URLs, licence identifiers and retrieval dates are retained in `sources.json`. No Oxford dictionary bulk import, COCA leak, external model generation, learner progress mutation or book pipeline mutation was used for this release.

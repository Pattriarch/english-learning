# Full chapter lesson pipeline

`scripts/generate_new_coursebooks.py` stages complete lessons for the 59 major chapters in the supplied Clear Speech, Great Writing and Viewpoint books. It does not register lessons, publish source material or modify learner progress. Read `NEW-COURSEBOOKS-SOURCE-INTAKE.md` for the independently prepared page and recording inventory.

## Source and lesson contract

Each unit uses its entire student chapter, all aligned teacher/key/workbook pages, and the explicitly mapped supplements. Every source image is attached to every author and reviewer call. The semantic inventory starts from the full text and images; extracted headings are provisional candidates rather than a substitute for reading. An independent review must accept the exact inventory before the lesson is drafted.

The lesson contract is implemented in `coursebook_lesson_template.py`: 6–12 substantial explanatory sections, 8–16 explained examples and 16–30 original free-response tasks. Every independently accepted teaching point maps to theory and practice. Six stages cover diagnosis, input, practice, independent written and spoken production, revision of the learner's own answer, and delayed transfer. The transfer stage specifies a delay of 7–60 days. The app, rather than the authoring receipt, determines when a stage is available and whether a learner has submitted evidence.

Verified private recordings use the exact approved material IDs, transcript hashes, audio hashes and URLs from `data/new-coursebooks/audio/materials.json`. Missing Clear Speech transcripts defer their chapter. Viewpoint scripts remain scripts when recorded media were not supplied. Source-aligned ASR is not an independent acoustic judgment or a pronunciation score.

The source set binds only the selected intake book/unit and used companion metadata. The audio registry binds only the selected unit's materials. Adding unrelated chapters or approved audio therefore preserves existing work; changing a selected source, image or transcript invalidates it. Full chapter and companion page packs remain pinned to their exact bytes.

Missing prerequisites referenced inside a chapter can be supplied in `data/new-coursebooks/lesson-evidence/<unitId>.json`. Selected local supplement pages and externally sourced pages keep their actual page numbers, original-file hashes, page-image hashes and exact scope notes. The additive file changes only that unit's fresh source set; it does not rewrite the frozen intake or unrelated chapters. A failed source inventory must be rerun against the complete evidence before lesson authoring.

## Run and resume

```text
python app/scripts/generate_new_coursebooks.py --dry-run --audio-registry app/data/new-coursebooks/audio/materials.json
python app/scripts/generate_new_coursebooks.py --generate --unit great-writing-4-4-003 --timeout 1800
python app/scripts/generate_new_coursebooks.py --analyze-only --workers 8 --audio-registry app/data/new-coursebooks/audio/materials.json --exclude-unit great-writing-4-4-003 --exclude-unit clear-speech-3-001
python app/scripts/generate_new_coursebooks.py --generate --workers 8 --audio-registry app/data/new-coursebooks/audio/materials.json --timeout 1800
python -m unittest discover -s app/scripts -p test_generate_new_coursebooks.py
```

The multi-chapter/parallel command refuses to start until at least one complete pilot still passes independent acceptance verification. Between one and eight chapter workers can run. Ready chapters run first; waiting audio is reconsidered every 45 seconds while other jobs remain active. A run with only waiting audio stops without invoking a model and can be resumed after the registry is updated.

`--analyze-only` is a separate source-inventory stage and may run before a full lesson pilot is accepted. It performs the same full-page analysis and independent review, writes `analysis-verified.json`, and stops before lesson drafting. Its operational file is `source-analysis-status.json`, explicitly marked `stage: source-analysis`; its verified counts are inventories, not finished lessons. Both stages use the same source directories and model checkpoints, so a later full lesson run reuses the accepted inventory. Use exact `--exclude-unit` IDs for chapters already being processed elsewhere, and wait for the source worker pool to drain before dispatching full lessons on those same units.

`data/new-coursebook-lessons/run-status.json` records every selected chapter and the counts for queued, running, verified, failed, waiting-audio and provider-paused. An exit code of zero with waiting-audio counts is deferred work, not complete coverage. Failed chapters give phase `incomplete` and exit code 1. A quota/authentication pause gives exit code 2, preserves `provider-paused.json`, stops new chapter dispatch and stops new model stages in already running chapters after their current call returns. Resume that circuit with `--resume-after-quota` only after the external limit or authentication has recovered. No reset credit is consumed.

New full-chapter author/format-repair calls use Sol; source inventories and independent semantic reviews use Astra. Calls use the existing authenticated CLI, private file-backed standard input and bounded subprocess waits. Each new real invocation records its explicit model, role, exact input/schema/image hashes and HTTP arguments in a hash-bound `.invocation.json`; historical accepted calls remain unchanged and are not relabeled. The shared `codex_transport.codex_http_arguments()` selects OpenAI Responses over HTTP without changing account authentication or global configuration. This avoids repeated WebSocket retries observed on this machine. Shell tools, web search, project rules and persistent conversation state are disabled. No model is invoked by the dry-run or tests.

Fresh repairs and whole reviews that continue a chapter with historical author instructions receive a separate `runtimeGuidance` payload containing the exact versioned application/user contract and its text digest. It describes actual transcript disclosure, whole-text synthesis and prior-answer access independently of the candidate's claims. The supplement is bound by request and invocation hashes; it changes neither the original author-input hash nor source identity. Existing committed calls without it retain their exact payload on retry and verification, and already current author prompts receive no duplicate supplement. Historical reviews are never rewritten to claim they received these newer facts.

`coursebook_author_probe.py` is a separate, bounded author comparison for Great Writing 1 unit5. The main coordinator must exclude that unit. In a separate process it uses the same current full source and accepted source inventory, a fresh application contract and an explicitly recorded `lesson-author-probe` Astra/high policy, followed by a separate whole semantic review that receives no earlier author's drafts or findings. At most two format repairs are allowed. Every call requires real invocation evidence. The private `probe-result.json` always has `publicationReady: false`; it never creates `verified.json` or replaces the normal author/review chain. Its `--check` mode reconstructs the exact source, policy, requests and responses without model calls. Adopting a probe candidate requires a separately implemented, explicit author contract and fresh normal publication validation.

## Acceptance evidence

Every source version has its own immutable directory under `data/new-coursebook-lessons/units/<unitId>/<sourceSetSha256>/`. Requests retain the exact prompt, payload, native and transported schemas, and all attachment hashes. Rejected or structurally invalid drafts remain available; corrections require a fresh independent review. Review receipt hashes cannot substitute for an actual matching request and response.

The application lesson ID is deterministically normalized to `book-<unitId>` before independent review. This changes no teaching text, level, source mapping or task. The raw returned draft remains unchanged; an identity-normalization record binds its bytes, the exact before/after ID and the normalized candidate. The final receipt verifies that record and the independent review of the exact normalized lesson. Substantive or depth failures require explicit correction and a new review. Author instructions list the existing validation floors explicitly; known historical prompts are accepted only for exact, unchanged cached source/schema/image requests.

Precise direct editorial corrections, including proposals authored by AI agents, can use `editorial-patch.json`, bound to the exact source and raw candidate bytes/value. Only explicitly allowed existing text fields can change, with exact before/after values and a reason; IDs, source coverage and approved audio cannot change through this path. Guarded original-material text may be edited without altering supplied recordings or transcripts. The untouched raw draft and the separate editorial proposal remain available. The entire corrected chapter must still pass all structural checks and an independent semantic review. Hash-bound `editorial-findings.json` observations are included in that review; changing either record invalidates an older acceptance.

Recipient-facing messages and learning reflections can have separate word budgets: `Message: 55–75 слов; Reflection: 20–35 слов`. Matching line-start headers are required in reference answers, and every body is counted independently. Partial, duplicated, unknown or missing labeled blocks fail validation. Normal single-response tasks retain their whole-answer range. This lets an authentic email stay free of lesson commentary while the learner still explains the language choices.

The final `verified.json` embeds the exact analysis and lesson accepted by their independent reviews. `analysis.json` and `lesson.json` must match those values. A consuming publisher must call `verify_ready` using a freshly loaded source bundle and the original checkpoint directory. Merely finding a receipt or counting source files is insufficient. Private source pages, audio, transcripts and model working files are not the distributable course release.

## Verify and publish the complete intake

Use the same approved-audio registry for publication as for authoring. Omitting it creates a different source set for Clear Speech and reports those reviewed chapters as missing; it does not mean their stored reviews have been lost.

```text
python app/scripts/publish_new_coursebooks.py --check --audio-registry app/data/new-coursebooks/audio/materials.json
python app/scripts/publish_new_coursebooks.py --publish --audio-registry app/data/new-coursebooks/audio/materials.json
```

The check reconstructs all 59 current source bundles and verifies each matching receipt. Publication waits for all 59 chapters and then validates the combined 931-lesson book release. It preserves learner progress and original source books; private source files are needed to reproduce this source-based publication check, but are not committed with the lesson adaptations.

When only source-file bookkeeping has changed, an earlier structurally valid analysis can seed a new source directory. The complete chapter text, images, metadata, audio and heading candidates must remain exactly equal. `analysis-seed.json` explicitly records this as an unverified candidate with exact original artifact hashes; it does not manufacture a model draft or reuse an old acceptance. The new source version still requires a fresh independent inventory review and a full independently reviewed lesson.

# Complete private source intake of the new books

The supplied `книги/more` collection now has full-page extraction, rather than a table-of-contents-only inventory. The metadata manifest is `content/new-coursebooks-intake.json`; it does not publish lessons in `library.json` or change learner progress.

| Student Book | Actual edition | Major units | Physical PDF pages |
| --- | --- | ---: | ---: |
| Clear Speech | Third Edition, 2005 | 15 | 194 |
| Great Writing 1 | Fourth Edition, 2014 | 8 | 287 |
| Great Writing 2 | Fourth Edition, 2014 | 11 | 321 |
| Great Writing 3 | Third Edition, 2015 | 7 | 264 |
| Great Writing 4 | Fourth Edition, 2014 | 6 | 227 |
| Viewpoint 1 Student's Book | Cambridge, 2012 | 12 | 170 |
| **Total** | | **59** | **1,463** |

The nine companion PDFs also have complete OCR and page images: **761 additional pages**, for **2,224 physical pages across all 15 PDFs**, with zero OCR process errors. This includes Great Writing 3/4 keys and teacher notes, Viewpoint 1 Teacher's Edition, Workbook, CEFR Guide and video worksheets/scripts, and the Viewpoint 2 Workbook. Frontmatter, appendices, keys and backmatter remain distinct from major teaching units.

## Grounding files

Private artifacts live under `app/data/new-coursebooks/` and remain ignored by Git:

- `{book-id}/pages.json`: every physical page, original OCR lines/word boxes, reconstructed rows, native PDF text and image hashes. `{book-id}/images/{page}.jpg` retains every original page image.
- `units/{unit-id}.json`: all **59** complete chapter sources, with continuous PDF-page inventory, printed page numbers, full OCR text, per-page text, source/image hashes, audio references and companion-unit references.
- `supplements/{id}.json`: **34** separate supplementary ranges from the six Student Books. Every Student Book PDF page belongs to exactly one frontmatter, chapter or supplement range.
- `companions/{companion-id}/units/NNN.json`: compact source ranges for the matching major unit. Answer-key boundaries can share a PDF page; use the actual unit heading and printed exercise/page numbers. Retain page images because OCR can align the two columns into the same tab-separated row.
- `source-index.json`: complete source index and suggested semantic subdivisions. Suggestions use actual headings such as “Writing the Introduction”, “Building Better Vocabulary” and “Original Student Writing”; they are candidates for pedagogical review, not automatically published lessons.

All 59 major chapter-start titles were visually checked against the supplied tables of contents and rendered physical pages. Great Writing 2 frontmatter is out of printed order. In Great Writing 3, PDF 244 is printed 229 and PDF 245 is printed 231: printed page 230 is absent and is never synthesized. Main chapters use one mapping; later appendices use the corrected mapping.

## Audio and companion limits

The manifest transcribes all **82** entries in the Clear Speech Student Audio CD table from PDF page 194 / printed page 174. Every track has its source filename, hash, duration, unit and task letter. Tracks 01, 02 and 82 were also checked by recording content in the earlier intake. The Student CD covers selected exercises; it does not imply availability of the full Classroom Audio set. Handwritten answers in the Clear Speech scan are not treated as a verified answer key.

Viewpoint 1 audio/video recordings remain absent. The Teacher's Edition contains Student's Book audio scripts, and the video worksheets contain scripts; their presence is explicitly distinct from recorded media. Viewpoint 2 is represented only as a companion Workbook, not a complete second-level course.

The metadata-only `content/book-recordings.json` registers the 82 verified local MP3s. A lesson material can reference `/book-recordings/clear-speech-3-track-001.mp3` through `/book-recordings/clear-speech-3-track-082.mp3`. Each entry preserves the book, unit, exact task letter, source SHA-256 and duration. `GET` and `HEAD` support HTTP byte ranges and ETags for audio playback and seeking. The server opens only registered paths beneath `книги` using `os.OpenRoot`, verifies the exact response bytes against their SHA-256, and rejects altered recordings with HTTP 409. Missing recordings return 404. No source recording is distributed in Git.

## Private source transcript preparation

`scripts/prepare_coursebook_audio.py` prepares checkpointed transcripts beneath `data/new-coursebooks/audio/`. The local `base.en` service at `127.0.0.1:8080/inference` supplies raw ASR for all 82 tracks. A single Codex review worker reconciles every track with its verified task mapping and **all** original chapter page images, records exact corrections, and holds unresolved tracks. Each whole unit enters `materials.json` only when every assigned track is source-checked. Materials pin exact transcript UTF-8 SHA-256, original audio SHA-256, absolute local source path, relevant core Student Book pages and concrete alignment evidence. Changed ASR or source image evidence invalidates the review; additions for other units do not change existing material objects.

ASR is not a verified answer key. A real base.en failure changed a `bead / bed` contrast into three `bed` tokens. The optional second decoder uses the official [small.en-q5_1 model](https://huggingface.co/ggerganov/whisper.cpp/blob/c521a4b02f422512d734391fdf08bb08c0862f68/ggml-small.en-q5_1.bin), pinned to 190,098,681 bytes and SHA-256 `bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30`. It runs the existing whisper.cpp CLI in a hidden child process, without changing the active speech service or app settings. Secondary recognition is additional evidence, not proof by itself. Handwritten circles/answers in the scan are never authoritative. Source-checked transcripts are **not independently verified acoustic transcriptions**, and no pronunciation-quality assessment is claimed.

```text
python app/scripts/prepare_coursebook_audio.py --asr
python app/scripts/prepare_coursebook_audio.py --review
python app/scripts/prepare_coursebook_audio.py --install-secondary-model
python app/scripts/prepare_coursebook_audio.py --secondary-asr --tracks 10 11
python app/scripts/prepare_coursebook_audio.py --review --unit 2
python app/scripts/prepare_coursebook_audio.py --assemble
python -m unittest discover -s app/scripts -p test_prepare_coursebook_audio.py
```

The second decoder is optional and only downloads when explicitly selected. Preserve `asr/`, `secondary-asr/`, `reviews/` and `materials.json` as private artifacts. A review with unresolved uncertainty remains pending even if a model mistakenly labels it source-checked. The twelve source-transcript pipeline tests invoke neither a model nor a speech server; one additionally verifies all 82 private materials when present.

For rare isolated-word ambiguity, `--context-words` supplies the complete printed vocabulary inventory, while `--constrained-items <private-spec.json>` decodes short original-audio crops with every printed row alternative allowed. The latter specification contains `track`, core `pages`, and `items` with `item`, `offsetMs`, `durationMs` and `allPrintedAlternatives`; it never supplies expected answers. Exact crop, grammar and raw recognition results stay in `constrained-asr/` and are hashed into review evidence. This resolved out-of-task spellings in track 44 by recognizing against the actual three-way alternatives. Constraint bias is documented, and such recognition remains source-alignment evidence rather than an independent acoustic verification. Follow-up editorial resolutions preserve the initial uncertainty, exact evidence and rationale in private review records.

Exact crops use `soundfile` to create sample-bounded temporary PCM WAV files. Decoder offset/duration flags alone proved insufficient: decoding could extend past a requested duration. Crop SHA-256, sample rate and sample count are retained. The `--fragment-items` variant uses the same exact crops without lexical constraints. Some constrained Whisper attempts remained incomplete or repeated the wrong consonant; those outputs are retained as failed evidence and were not used as answer keys.

The final three difficult recordings were also inspected by the official [Facebook wav2vec2 phoneme-recognition model](https://huggingface.co/facebook/wav2vec2-lv-60-espeak-cv-ft), which outputs phonetic labels from 16 kHz input. `scripts/inspect_coursebook_phonemes.py` pins revision `fdf22f0210322b799533bc499dd3e489a9452bdc` and weights SHA-256 `3173bde9e9ce490fa0f989e413c42f25bc1820c020adc1e6b9b87025b3cfcc5e`. Its private isolated runtime uses CPU `torch==2.8.0`, `transformers==4.57.1`, `scipy` and `soundfile`; the 1.26 GB model is optional, loaded locally with remote code disabled and weights-only loading. No service or application setting changes. Whole-row and individual-word CTC outputs distinguished teeth/teethe and seal/zeal without an expected word list, enabling explicit source-backed spelling corrections. Phoneme labels themselves can contain errors and are not calibrated learner pronunciation scores.

```text
python app/scripts/inspect_coursebook_phonemes.py --download
<isolated-phoneme-python> app/scripts/inspect_coursebook_phonemes.py --spec <private-clip-spec.json>
```

**Completed source-audio coverage: 15 units, 82 source-reconciled materials, no pending units.** All 137 core Student Book pages were included in the visual transcript reviews. Material text remains an orthographic transcript, not an official acoustic answer key: it does not invent noun/verb labels for the homographs excuse/use, and one isolated American tot/taught spelling has an explicit limitation. Do not derive semantic or phonetic grading keys from such spellings alone. The original recordings stay available for actual listening practice.

## Reproduce and verify

Use the bundled Python runtime:

```text
python app/scripts/intake_new_coursebooks.py --extract --workers 3
python app/scripts/intake_new_coursebooks.py --extract --companions --workers 3
python app/scripts/prepare_coursebook_manifest.py
python app/scripts/prepare_book_recordings.py
python app/scripts/intake_new_coursebooks.py --assemble
python -m unittest discover -s app/scripts -p test_new_coursebooks_intake.py
```

Extraction resumes at individual pages and rejects changed original PDF identities. Windows OCR helpers run without a visible window. No model is invoked, and originals are never changed. Verification includes the complete 2,224-page inventories, every chapter/supplement image hash, source-text hashes, all companion references, the 82-track mapping and audio hashes. **Nine intake tests pass.** Private-artifact tests skip in a clone without the supplied books. Dedicated Go tests exercise audio range/conditional requests, strict registration, changed bytes, missing sources and confinement (the symlink test skips when Windows denies symlink creation).

This is full source preparation, not full semantic proofreading. OCR can still misread IPA, handwriting, crossed-out examples and tables; lesson generation must inspect all provided page images. The largest chapter has about 57,000 characters of source text. The old In Use generator repeats text in both the aggregate and per-page fields, so its 65,000-character limit can be exceeded by duplication. Preserve every page and use either a nonduplicated chapter input or actual conceptual subdivisions; never silently truncate or divide into arbitrary two-page lessons.

## Isolated Great Writing 2 unit 3 dependency resolution

The first unit 3 source analysis found a prerequisite outside its chapter and an external peer-review sheet. The private `lesson-evidence/great-writing-2-4-003.json` now supplies physical Student Book page 29 (printed 12), pages 274–276 (printed 258–260, comma handbook), pages 293–297 (printed 277–281, optional writing vocabulary), and pages 302–304 (printed 286–288, Building Better Sentences Practices 4–6). Every selected image was visually inspected. Notes distinguish the exact referenced sections from preceding/following activities on shared pages. These pages deepen the original chapter on physical pages 63–86; they do not expand its page provenance or pretend to teach later chapters in full.

The [official publisher peer-editing PDF](https://ngl.cengage.com/sites/sites/default/files/documents/gw2_students_peer_editing.pdf), SHA-256 `6894859fc5200d9313e226a4934c3448f2f506061ff4c7d1a0e972a7dad16cd9`, has 16 pages. Its physical page 4 matches Sheet 3, Unit 3, Activity 15, printed page 68 and all four topic choices. The original PDF, complete rendered page, extracted text, 2017 footer and embedded 2014 draft disclaimer remain private. This exact alignment supports using the worksheet; it does not establish an identical final edition. The local appendix contains only the Unit 1 sample on physical pages 315–316, not Sheet 3.

`scripts/prepare_gw2_unit3_evidence.py --download --write` reproduces this evidence from pinned source bytes. A later invocation without flags verifies the existing artifact. It refuses to overwrite differing evidence while authoring may be active. Rendering uses PyMuPDF 1.28.2; a different rendered image must be inspected before its hash is accepted. No global intake metadata or chapter pack changes are made. Verification after addition retained the exact hashes of the intake and all 59 chapter packs, and all other ten Great Writing 2 bundles. The selected bundle contains 37 attachments: 24 chapter pages, 12 local reference pages and one external worksheet page.

An independent appendix-mapping issue is recorded for a later isolated correction: the frozen Great Writing 2 supplement 04 range 316–317 omits the first Unit 1 sample page and includes the index. The verified sample is physical 315–316/printed 299–300. Do not globally rebuild the frozen intake during active authoring merely to fix this unused appendix range.

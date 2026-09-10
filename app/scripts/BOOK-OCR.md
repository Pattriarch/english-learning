# Full scanned coursebook extraction

`book_ocr.py` and `book_ocr.ps1` extract both full pages of every numbered unit in Advanced Grammar in Use (100 units) and Phrasal Verbs in Use Intermediate (70 units). The other books use their existing text layer and a separate extraction pipeline.

Run with Python containing `pypdfium2` on Windows with the English OCR language pack:

```powershell
python app/scripts/book_ocr.py
```

Two isolated processes render the books at 216 dpi, respecting a conservative maximum image dimension, then use persistent Windows OCR processes. Successfully written units are skipped on rerun. Every unit is written through a temporary file and atomic replacement. `--limit 1` previews one unit per book; `--force` reprocesses; `--report-only` rebuilds geometric reading order and the report without new OCR.

Private outputs are in `app/data/parsed-books/<unit-id>.json`. Each includes page numbers, full text, separate page text, original OCR line order, word bounding boxes and spatially reconstructed rows. Tabs retain substantial horizontal gaps rather than inventing words or answer blanks. The full-page PNGs and worker manifests remain in `app/data/parsed-books-ocr-work/` for verification.

`app/data/parsed-books-ocr-report.json` reports coverage and missing/empty pages. `app/data/parsed-books-ocr-visual-review.json` records the exact seven pages sampled and the recognition defects found. Full coverage means all 340 unit pages were processed; it does not mean every character was manually proofread. In particular, handwritten model answers, strike-through, phonetics and complex tables must be verified from the original pages. No answer keys are inferred by this extraction.

`book_ocr_fix.py` applies source-verified transcription corrections from the private `parsed-books-ocr-corrections.json` manifest. There are ten correction groups across five sampled units/eight pages, including full handwritten text in Phrasal Intermediate 8.1 and Unit 70 section B. Corrections preserve raw OCR and record page/image provenance. The filled examples reproduced here were already filled in the book; no exercise answers are invented. Full reruns reapply the same corrections.

`book_ocr_audit.py` scans all 170 units without modifying them, ranking possible garbling against a lexicon from the other supplied books. `--annotate` adds only `quality.ocrAudit` metadata with page-level excerpts and explicit possible false positives. The corruption audit is not proof of error-free text.

`book_supplement_ocr.py` extracts seven indexed endmatter sections (73 full pages) into `app/data/parsed-book-supplements/`, separately from numbered lessons. The mini dictionary is read by its three columns, not by visually horizontal rows. The shared supplement index and other 21 sections are maintained by the text-layer extraction pipeline.

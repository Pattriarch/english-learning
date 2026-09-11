# Book import source contract

`library.json` keeps stable book/unit IDs and PDF `page` / `endPage` boundaries. A book filename is a relative, forward-slash path below the project’s `книги` directory; for example, `more/Clear_Speech.pdf`. Absolute paths, traversal, Windows device names, alternate streams and ambiguous separators are rejected. PDF HTTP requests must match a catalog entry and use Go’s root-constrained file access, including for symlinks/junctions. The source PDFs remain local and untracked.

For teaching units, every `pages` array is a complete ordered inventory of PDF pages. A chapter on PDF pages 22 through 29 uses `[22,23,24,25,26,27,28,29]`, not `[22,29]`. Optional catalog `pages` must agree with the inclusive boundaries. Two-page In Use records retain their existing `[start,end]` arrays; existing published IDs and provenance do not need migration. Single-page units use one page number.

The shared Python `book_source_contract.py` enforces this representation in OCR completion checks, extraction, image rendering, lesson generation and release publication. Provided `pageTexts` must contain each page exactly once, in order. Equivalent PDF editions can map different `sourcePage` numbers, but the canonical page inventory must be complete. Both text and visual source inventories are checked against the catalog before generation; no chapter is silently truncated.

Every page image is hashed and attached. Publication requires a matching hash and page-specific visual coverage for every supplied image. The runtime validates all image hashes and checks the complete page inventory in local sources and portable releases. Readiness caching includes intermediate image files, so changing a middle page invalidates its lesson availability. Existing release semantics remain: an exact published release may substitute absent private artifacts; a present but changed artifact is rejected.

Supplementary endmatter retains its separate historical range schema. This update does not reinterpret previously published appendices or regenerate any source/lesson files.

## Course adaptation still required

This is infrastructure, not a claim that the newly supplied coursebooks have become ready lessons. The existing In Use generator still requires at least four explanatory sections, four examples and eight exercises with translate/rewrite/write/speak coverage. Its complete input limit remains 65,000 characters and its lesson duration is clamped to 30–90 minutes. Long chapters exceeding that limit require a separate complete-source workflow or pedagogically justified subsections; do not split them mechanically into two-page chunks. Audio alignment, listening activities, a staged writing process and missing-media handling belong to course-specific lesson preparation.

## Verification

- Full Go studio package tests pass, including long-source cache, five-page portable release, middle-image change, missing-middle-page and registered nested-PDF route cases.
- 36 Python source/build/release/supplement tests pass; symlink-creation checks are skipped on Windows when the account lacks symlink privileges.
- Read-only `publish_book_release.py --check` still accepts all 872 existing canonical lessons, with no rejected entries or modified release files.

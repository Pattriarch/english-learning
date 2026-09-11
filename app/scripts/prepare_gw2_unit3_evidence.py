"""Prepare the verified, private source dependencies of GW2 fourth-edition unit 3.

Does not rewrite intake metadata, chapter packs, published lessons, or originals.
The publisher worksheet is pinned to inspected bytes, not inferred to be a final
fourth-edition publication: its 2017 footer and 2014 draft notice are retained.
Run with --download --write once; subsequent runs verify and leave bytes alone.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

APP = Path(__file__).resolve().parents[1]
ROOT = APP / "data" / "new-coursebooks"
UNIT_ID = "great-writing-2-4-003"
BOOK_ID = "great-writing-2-4"
BOOK_SHA = "b7b29706bf801030afe99cf5f40e0b438123afba812e5e65a87a3205498b0770"
URL = "https://ngl.cengage.com/sites/sites/default/files/documents/gw2_students_peer_editing.pdf"
PDF_SHA = "6894859fc5200d9313e226a4934c3448f2f506061ff4c7d1a0e972a7dad16cd9"
IMAGE_SHA = "60c9ef1b3a6261f1cef5cd7852635f128b118918cccfe7e6b0ceeb573932e649"
RELATIVE = Path("external/gw2-peer-editing")
GROUPS = {
    "paragraph-feature-prerequisite": [29],
    "commas-handbook": [274, 275, 276],
    "useful-vocabulary-for-original-writing": [293, 294, 295, 296, 297],
    "building-better-sentences-practices-4-6": [302, 303, 304],
}
NOTES = [
    "Physical Student Book page 29 is printed page 12, explicitly referenced by Activity 14 on physical page 85/printed 68. The four paragraph features are a main-idea topic sentence, unity, first-line indentation in the book's paragraph format, and a logical concluding sentence. The preceding Activity 6 on the shared page belongs to Unit 1.",
    "Physical pages 274-276 are printed 258-260, the comma handbook section explicitly referenced by physical chapter page 77/printed 60. The relevant section starts at Commas on page 274 and includes Activity 3 through item 20 on page 276; preceding end-punctuation activities and following Apostrophes are neighboring handbook content, not additional Unit 3 objectives.",
    "Physical pages 293-297 are printed 277-281: the full Useful Vocabulary for Better Writing reference suggested in Activity 14 on physical page 85/printed 68. This is optional phrase support for independent drafting, spanning examples, conclusions, comparison, contrast, narration, processes, definitions, cause/effect, description, opinion, persuasion, and response; it is not a claim that all later rhetorical genres are fully taught in Unit 3.",
    "Physical pages 302-304 are printed 286-288. Unit 3 references Practice 4 on chapter page 70/printed 53, Practice 5 on page 77/printed 60, and Practice 6 on page 82/printed 65. Practice 4 A-C starts below the preceding Unit 2 practice on physical page 302. Practice 5 A-C occupies the upper part of page 303. Practice 6 A is at the bottom of page 303 and B-C at the top of page 304; Practice 7 Unit 4 below it is neighboring content. Full images and text are retained so boundaries remain visible.",
    "The external official publisher PDF's physical page 4 says Peer Editing Sheet 3, Unit 3, Activity 15, page 68. Its four topic choices match the Student Book's Activity 13 on physical page 84. All eleven review criteria are supplied, including capitalization and sentence-error checks. This is a peer-feedback worksheet, not an answer key.",
    "The publisher worksheet carries a 2017 copyright footer and an embedded 2014 draft disclaimer stating that content may not match the published product. Both remain present in the original PDF, page image, and extracted text. Alignment is established by the exact unit/activity/page/topic matches, not by an unsupported assertion of identical final edition.",
    "The local Student Book appendix on physical pages 315-316/printed 299-300 contains only a Unit 1 peer-editing sample, not Sheet 3. It is not used as a substitute. No source dependency below changes the chapter's physical page range 63-86.",
]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def checked_bytes(path, expected):
    raw = path.read_bytes()
    if sha(raw) != expected:
        raise ValueError(f"Source identity differs: {path}")
    return raw


def write_once(path, raw):
    if path.exists():
        if path.read_bytes() != raw:
            raise ValueError(f"Existing evidence differs; do not invalidate active authoring: {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_bytes(raw)
    temp.replace(path)


def prepare(download=False, write=False):
    import pymupdf

    whole = json.loads((ROOT / BOOK_ID / "pages.json").read_text(encoding="utf8"))
    if whole["bookId"] != BOOK_ID or whole["sha256"] != BOOK_SHA:
        raise ValueError("Unexpected Student Book source")
    checked_bytes(APP.parent / "книги" / whole["filename"], BOOK_SHA)
    pages = {page["page"]: page for page in whole["pages"]}
    for number in [number for group in GROUPS.values() for number in group]:
        page = pages[number]
        if page.get("error") or not page["text"].strip():
            raise ValueError(f"Missing extracted page: {number}")
        checked_bytes(ROOT / page["image"], page["imageSHA256"])

    original = ROOT / RELATIVE / "gw2_students_peer_editing.pdf"
    if not original.exists() and download:
        with urllib.request.urlopen(URL, timeout=60) as response:
            raw = response.read(10 * 1024 * 1024 + 1)
        if not raw.startswith(b"%PDF") or sha(raw) != PDF_SHA:
            raise ValueError("Publisher download differs from the inspected PDF")
        write_once(original, raw)
    checked_bytes(original, PDF_SHA)
    with pymupdf.open(original) as doc:
        if len(doc) != 16:
            raise ValueError("Publisher page inventory differs")
        page = doc[3]
        # Native stream order keeps the vertical draft notice separate. Spatial
        # sort incorrectly interleaves that notice into the worksheet questions.
        text = "".join(ch for ch in page.get_text(sort=False) if ord(ch) >= 32 or ch in "\n\t")
        compact = " ".join(text.split())
        for marker in ("Peer Editing Sheet 3", "Unit 3, Activity 15, page 68", "animal communication",
                       "international flights", "pollution", "smart phones", "2017", "2014",
                       "does not guarantee this page will contain current material"):
            if marker not in compact:
                raise ValueError("Publisher worksheet alignment changed: " + marker)
        jpg = page.get_pixmap(dpi=160, alpha=False).tobytes("jpeg", jpg_quality=90)
    if sha(jpg) != IMAGE_SHA:
        raise ValueError("Rendered page differs from the visually inspected image; inspect before accepting")
    if write:
        write_once(ROOT / RELATIVE / "page-4.jpg", jpg)
    checked_bytes(ROOT / RELATIVE / "page-4.jpg", IMAGE_SHA)
    evidence = {"version": 1, "unitId": UNIT_ID, "bookId": BOOK_ID,
        "studentSupplementPages": GROUPS,
        "externalSources": [{"id": "great-writing-2-peer-editing", "title": "Great Writing 2: Peer Editing Sheet 3",
            "kind": "aligned-publisher-peer-editing-sheet", "sourceUrl": URL,
            "sourceFile": (RELATIVE / original.name).as_posix(), "sourceSha256": PDF_SHA,
            "pages": [4], "pageTexts": [{"page": 4, "text": text,
                "image": (RELATIVE / "page-4.jpg").as_posix(), "imageSHA256": IMAGE_SHA}]}],
        "notes": NOTES}
    raw = (json.dumps(evidence, ensure_ascii=False, indent=2) + "\n").encode("utf8")
    path = ROOT / "lesson-evidence" / (UNIT_ID + ".json")
    if write:
        write_once(path, raw)
    checked_bytes(path, sha(raw))
    return {"unitId": UNIT_ID, "evidenceSha256": sha(raw), "studentSupplementPages": 12,
            "externalPages": 1, "publisherPdfSha256": PDF_SHA}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    print(json.dumps(prepare(args.download, args.write), indent=2))

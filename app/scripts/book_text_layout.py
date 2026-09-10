"""Private, reproducible page-layout extraction of the supplied text-layer books.

The public catalog is metadata only. This writes private source records under
ignored app/data. Tables retain their row/cell relationships; text blocks retain
paragraph boundaries. Murphy's supplied clean ebook replaces the demonstrably
damaged OCR layer in its equivalent print edition, with explicit provenance.
Requires PyMuPDF. Run with the bundled Python runtime.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import statistics
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "app/data/parsed-books"
CATALOG = ROOT / "app/content/library.json"
REPORT = ROOT / "app/data/parsed-books-text-report.json"
SCHEMA_VERSION = 1
REVIEWED_UNITS = {f"grammar-intermediate{edition}-{n:03d}" for edition in ("", "-ebook") for n in (1, 2, 3)}

# These are known split-ligature artifacts observed in these PDFs. No general
# dictionary autocorrection is applied: unfamiliar vocabulary must survive.
LIGATURE_WORDS = [
    "after", "afterwards", "afternoon", "often", "soft", "softer", "softly",
    "software", "shift", "shifts", "left", "lift", "lifts", "gift", "gifts",
    "different", "difference", "differences", "difficult", "difficulty",
    "difficulties", "offer", "offers", "offered", "offering", "officer",
    "officers", "office", "offices", "official", "officially", "effect",
    "effects", "effective", "effectively", "effort", "efforts", "coffee",
    "affect", "affected", "affects", "afford", "affordable", "suffer",
    "suffers", "suffered", "suffering", "traffic", "stuff", "staff",
    "first", "find", "flight", "profits", "film", "flat", "five", "field",
    "fierce", "benefit", "firm", "fine", "fighting", "selfish", "finding",
    "specific", "fish", "finish", "firms", "profit", "confident", "definitely",
    "fire", "floods", "figure", "fitness", "files", "significant", "flowers",
    "confide", "file", "filed", "final", "definition", "defining", "fulfil",
    "flavours", "flying", "flatly", "flawless", "filmed", "fingers", "fly",
    "financial", "kingfisher", "flew", "flowing", "fishing", "fit", "officials",
    "efficiently", "refine", "fulfilling", "fielding", "fixed", "terrified",
    "firing", "flung", "flickered", "finely", "flavour", "finally", "justified",
    "flooding", "flash", "profited", "unconfirmed", "financially", "flush",
    "elderflower", "flower", "modifications", "flatmate", "benefits", "fill",
    "finance", "fines", "flora", "influence", "figures", "affecting", "offences",
    "offenders", "offence", "sufficient", "offensive",
]
LIGATURE_PATTERNS = []
for word in LIGATURE_WORDS:
    for cut in range(2, len(word)):
        if word[cut - 2:cut] not in ("ff", "fi", "fl", "ft"):
            continue
        if cut < len(word):
            LIGATURE_PATTERNS.append(re.compile(r"\b(" + word[:cut] + r")\s+(" + word[cut:] + r")\b", re.I))


def atomic_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".layout.tmp")
    temp.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    temp.replace(path)


def clean_text(text: str, changes: dict) -> str:
    text = unicodedata.normalize("NFKC", text).replace("\u00ad", "")
    text = text.replace("\x00", "")
    # Visual verification of the original font glyphs: collocations adv 48,
    # collocations int 46, vocabulary adv 1/52/72 and vocabulary upper int 48.
    glyphs = {"\x07": " ", "\x08": " ", "\x1e": "ɜ", "\x1d": "ː", "\x1c": "ˈ",
              "\x1f": "ˈ", "\x19": "ʒ", "\uf769": "ɪ", "\ue03a": "ː", "\ue027": "ˈ", "\ue022": "ˌ", "\uf0a1": "○"}
    for old, new in glyphs.items():
        changes["verifiedFontGlyphsRepaired"] += text.count(old)
        text = text.replace(old, new)
    for pattern in LIGATURE_PATTERNS:
        text, count = pattern.subn(lambda m: m[1] + m[2], text)
        changes["splitLigaturesRepaired"] += count
    return re.sub(r"[ \t]+", " ", text).strip()


def paragraph(lines: list[str]) -> str:
    """Join visual wraps, keeping sentence/bullet/heading boundaries readable."""
    out = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if out and re.search(r"[A-Za-z]-$", out[-1]) and re.match(r"^[a-z]", line):
            # Do not guess whether a line-end hyphen belongs to the word.
            out[-1] += line
        elif out and not re.search(r"[.!?:;)\]]$", out[-1]) and not re.match(r"^(?:[A-Z]\b|\d+(?:\.\d+)?\s|[•●])", line):
            out[-1] += " " + line
        else:
            out.append(line)
    return "\n".join(out)


def overlaps_center(rect, bbox):
    return rect.contains(pymupdf.Point((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2))


def span_text(span, changes):
    value = span["text"]
    if span["font"] == "Times-PhoneticIPA":
        # This legacy font stores SAMPA-like ASCII codes, not the glyphs shown
        # on the page. Restrict mapping to that exact font, never English prose.
        mapping = str.maketrans({"T": "θ", "S": "ʃ", "O": "ɔ", "@": "ə", "U": "ʊ", "I": "ɪ",
                                 "{": "æ", "Z": "ʒ", "A": "ɑ", "D": "ð", "N": "ŋ", "'": "ˈ", ":": "ː"})
        converted = value.translate(mapping)
        changes["verifiedFontGlyphsRepaired"] += sum(a != b for a, b in zip(value, converted))
        value = converted
    return value


def extract_page(page, book_id: str):
    changes = {"splitLigaturesRepaired": 0, "footerLinesRemoved": 0, "verifiedFontGlyphsRepaired": 0}
    table_errors = []
    tables = []
    # Vector ruled tables in the In Use books can be reconstructed reliably.
    # Single-row picture frames are not tables.
    try:
        finder = page.find_tables()
        for table in finder.tables:
            if table.row_count < 2 or table.col_count < 2:
                continue
            rows = table.extract()
            if not rows or sum(bool(c and c.strip()) for row in rows for c in row) < 4:
                continue
            normalized = [[clean_text((c or "").replace("\n", " "), changes) for c in row] for row in rows]
            rows_text = [" | ".join(c.replace("|", "/") for c in row) for row in normalized]
            tables.append({"bbox": list(table.bbox), "rows": normalized, "text": "\n".join(rows_text)})
    except Exception as exc:
        table_errors.append(type(exc).__name__ + ": " + str(exc))
    rects = [pymupdf.Rect(t["bbox"]) for t in tables]
    items = []
    removed_footers = []
    for block_index, block in enumerate(page.get_text("dict", flags=pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES)["blocks"]):
        if block.get("type") != 0:
            continue
        parts = []
        lines = []
        kept_boxes = []
        sizes = []
        def finish_part():
            if lines:
                bbox = [min(b[0] for b in kept_boxes), min(b[1] for b in kept_boxes), max(b[2] for b in kept_boxes), max(b[3] for b in kept_boxes)]
                parts.append({"kind": "paragraph", "bbox": bbox, "text": paragraph(lines), "nativeOrder": block_index + len(parts) / 100,
                              "fontSize": round(statistics.median(sizes), 2)})
                lines.clear()
                kept_boxes.clear()
                sizes.clear()
        for line in block["lines"]:
            bbox = line["bbox"]
            if any(overlaps_center(rect, bbox) for rect in rects):
                continue
            value = clean_text("".join(span_text(s, changes) for s in line["spans"]), changes)
            if not value:
                continue
            footer = bbox[1] > page.rect.height * .92 and (
                re.fullmatch(r"\d{1,3}", value)
                or re.search(r"English (?:Vocabulary|Phrasal Verbs|Collocations) in Use", value)
                or re.search(r"(?:➜|→|Unit \d).*(?:Unit|Appendix)", value)
            )
            if footer:
                changes["footerLinesRemoved"] += 1
                removed_footers.append(value)
                continue
            size = max((s["size"] for s in line["spans"] if s["text"].strip()), default=10)
            # Some PDF producers put the end of the right dialogue before the
            # left dialogue in one text block. Break a regressing column here.
            column_jump = kept_boxes and bbox[1] < kept_boxes[-1][1] - 3 and abs(bbox[0] - kept_boxes[-1][0]) > page.rect.width * .08
            heading_change = sizes and abs(size - sizes[-1]) > max(1.4, sizes[-1] * .16)
            if column_jump or heading_change:
                finish_part()
            lines.append(value)
            kept_boxes.append(bbox)
            sizes.append(size)
        finish_part()
        items.extend(parts)
    for table in tables:
        items.append({"kind": "table", **table, "nativeOrder": -1})
    # Grammar ebooks are authored in semantic column order (observed and
    # visually compared); sorting their lines by Y would interleave contrasts.
    # Other books contain tables and floating labels; order complete blocks by
    # geometry, never concatenate alternating individual column lines.
    if book_id.startswith("grammar-") and not tables:
        items.sort(key=lambda item: item["nativeOrder"])
        order = "native-paragraph-order"
    else:
        # Rejoin a wrapped sentence fragmented into adjacent PDF blocks while
        # excluding a neighbouring column by its X extent.
        for item in items:
            if item.get("merged") or item["kind"] != "paragraph":
                continue
            while not re.search(r"[.!?:;)\]]$", item["text"]):
                box = item["bbox"]
                candidates = [other for other in items if other is not item and not other.get("merged")
                              and other["kind"] == "paragraph" and abs(other["fontSize"] - item["fontSize"]) < .6
                              and -3 <= other["bbox"][1] - box[3] <= 5
                              and other["bbox"][0] >= box[0] - 3 and other["bbox"][2] <= box[2] + 20
                              and other["bbox"][1] > box[1] + 3]
                if not candidates:
                    break
                other = min(candidates, key=lambda v: abs(v["bbox"][1] - box[3]))
                item["text"] += " " + other["text"]
                item["bbox"] = [min(box[0], other["bbox"][0]), min(box[1], other["bbox"][1]), max(box[2], other["bbox"][2]), max(box[3], other["bbox"][3])]
                other["merged"] = True
        items = [item for item in items if not item.get("merged")]
        items.sort(key=lambda item: (round(item["bbox"][1] / 4), item["bbox"][0]))
        order = "geometric-block-order-with-table-rows"
    text = "\n\n".join(item["text"] for item in items)
    bad = len(re.findall(r"[\ufffd\u0001-\u0008\u000b\u000c\u000e-\u001f\ue000-\uf8ff]", text))
    images = len(page.get_images())
    warnings = []
    if bad:
        warnings.append("unmapped_glyphs")
    if len(text) < 350:
        warnings.append("sparse_text_check_original_page")
    if images:
        warnings.append("illustrations_require_original_page")
    if tables:
        warnings.append("tables_reconstructed_from_vector_rules")
    if table_errors:
        warnings.append("table_extraction_error")
    return {
        "text": text, "blocks": items,
        "quality": {"characters": len(text), "blockCount": len(items), "tableCount": len(tables),
                    "imageObjectCount": images, "unmappedGlyphCount": bad,
                    "readingOrder": order, "warnings": warnings, **changes,
                    "removedFooters": removed_footers, "tableErrors": table_errors},
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*", help="Optional unit IDs, otherwise every text-layer unit")
    args = parser.parse_args()
    catalog = json.loads(CATALOG.read_text(encoding="utf8"))
    books = {b["id"]: b for b in catalog["books"]}
    selected = [b for b in catalog["books"] if b["source"] != "ocr-and-visual-toc"]
    docs = {b["id"]: pymupdf.open(ROOT / "книги" / b["filename"]) for b in selected}
    hashes = {b["id"]: hashlib.sha256((ROOT / "книги" / b["filename"]).read_bytes()).hexdigest() for b in selected}
    records, page_cache = [], {}
    work = [(b, u) for b in selected for u in b["units"] if not args.only or u["id"] in args.only]
    priority = {"grammar-intermediate-003": -3, "grammar-intermediate-001": -2, "grammar-intermediate-002": -1}
    work.sort(key=lambda pair: priority.get(pair[1]["id"], 0))
    for b, u in work:
        source_book, source_unit = b, u
        if b["id"] == "grammar-intermediate":
            source_book = books["grammar-intermediate-ebook"]
            source_unit = source_book["units"][u["unit"] - 1]
            assert source_unit["equivalentUnitId"] == u["id"]
            assert source_unit["title"] == u["title"]
        page_texts = []
        for offset, p in enumerate(range(source_unit["page"], source_unit["endPage"] + 1)):
            key = (source_book["id"], p)
            if key not in page_cache:
                page_cache[key] = extract_page(docs[source_book["id"]][p - 1], source_book["id"])
            result = page_cache[key]
            page_texts.append({"page": u["page"] + offset, "sourcePage": p, **result})
        text = "\n\n".join(p["text"] for p in page_texts)
        warnings = sorted({w for p in page_texts for w in p["quality"]["warnings"]})
        if source_book["id"] != b["id"]:
            warnings.append("equivalent_clean_ebook_replaces_damaged_ocr_layer")
        record = {
            "schemaVersion": SCHEMA_VERSION, "unitId": u["id"], "bookId": b["id"],
            "title": u["title"], "pages": [u["page"], u["endPage"]],
            "source": "text-layer-layout", "text": text, "pageTexts": page_texts,
            "provenance": {"filename": b["filename"], "sha256": hashes[b["id"]],
                           "textFilename": source_book["filename"], "textBookId": source_book["id"],
                           "textUnitId": source_unit["id"], "textPages": [source_unit["page"], source_unit["endPage"]],
                           "textSha256": hashes[source_book["id"]], "extractor": "PyMuPDF " + pymupdf.VersionBind},
            "quality": {"characters": len(text), "words": len(text.split()),
                        "pageCount": len(page_texts), "tableCount": sum(p["quality"]["tableCount"] for p in page_texts),
                        "unmappedGlyphCount": sum(p["quality"]["unmappedGlyphCount"] for p in page_texts),
                        "warnings": warnings, "manuallyReviewed": u["id"] in REVIEWED_UNITS,
                        "reviewScope": "Full two-page source checked visually: theory, examples and exercise instructions; picture and blank-line layout remains in PDF." if u["id"] in REVIEWED_UNITS else "Automated extraction; representative pages inspected per book.",
                        "status": "needs-source-check" if any(w in warnings for w in ["unmapped_glyphs", "sparse_text_check_original_page", "table_extraction_error"]) else "extracted"},
        }
        atomic_json(OUT / (u["id"] + ".json"), record)
        records.append({"unitId": u["id"], "bookId": b["id"], **record["quality"]})
        if len(records) <= 3 or len(records) % 50 == 0:
            print(f"{len(records)}/{len(work)} {u['id']} {len(text)} characters", flush=True)
    book_reports = []
    for b in selected:
        rows = [r for r in records if r["bookId"] == b["id"]]
        if not rows:
            continue
        book_reports.append({"bookId": b["id"], "filename": b["filename"], "units": len(rows),
                             "characters": sum(r["characters"] for r in rows),
                             "tableCount": sum(r["tableCount"] for r in rows),
                             "needsSourceCheck": [r["unitId"] for r in rows if r["status"] == "needs-source-check"]})
    report = {"createdAt": datetime.now(timezone.utc).isoformat(), "totalUnits": len(records),
              "expectedNonScanUnits": sum(len(b["units"]) for b in selected),
              "uniquePagesExtracted": len(page_cache), "books": book_reports, "units": records,
              "limitations": [
                  "Automated extraction is source material for lesson analysis, not a claim that every page was manually proofread.",
                  "Illustrations, timelines, handwritten answers, and embedded dictionary screenshots retain their meaning only in the original page.",
                  "Tables use vector rules when present; unruled tables and floating annotations remain separate text blocks.",
                  "No broad spelling correction: only an explicit observed split-ligature allowlist and visually verified font glyph mapping are repaired.",
              ],
              "visualSamples": [{"bookId": b["id"], "unitId": b["units"][2]["id"], "page": b["units"][2]["page"],
                                 "inspection": "Original theory page rendered and visually inspected; native blocks and table strategy chosen per book layout."}
                                for b in selected]}
    if not args.only:
        atomic_json(REPORT, report)
    print(json.dumps({"totalUnits": len(records), "books": book_reports}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()

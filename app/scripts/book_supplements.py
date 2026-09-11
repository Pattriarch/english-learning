"""Audit/index and privately extract teaching material outside numbered units.

Scanned Hewings / Phrasal Intermediate entries are indexed here; their OCR is
handled by book_ocr sources separately. Existing core-unit records are untouched.
"""
from pathlib import Path
import hashlib
import json
import re

import pymupdf
from book_text_layout import ROOT, atomic_json, clean_text, extract_page, span_text
from book_source_contract import pdf_source_path

INDEX = ROOT / "app/content/book-supplements.json"
OUT = ROOT / "app/data/parsed-book-supplements"

# Source page numbers are PDF page numbers, not the printed running pagination.
DEFINITIONS = {
    "grammar-elementary": [
        ("Active and passive", 251, 251, "reference"),
        ("List of irregular verbs", 252, 252, "reference"),
        ("Irregular verbs in groups", 253, 253, "reference"),
        ("Short forms (he’s / I’d / don’t etc.)", 254, 255, "reference"),
        ("Spelling", 256, 257, "reference"),
        ("Phrasal verbs (take off / give up etc.)", 258, 258, "reference"),
        ("Phrasal verbs + object", 259, 259, "reference"),
        ("Additional exercises 1–35: mixed grammar practice", 232, 250, "practice"),
    ],
    "grammar-intermediate": [
        ("Regular and irregular verbs", 303, 304, "reference", 316, 317),
        ("Present and past tenses", 305, 305, "reference", 318, 318),
        ("The future", 306, 306, "reference", 319, 319),
        ("Modal verbs (can/could/will/would etc.)", 307, 307, "reference", 320, 320),
        ("Short forms (I’m / you’ve / didn’t etc.)", 308, 308, "reference", 321, 321),
        ("Spelling", 309, 310, "reference", 322, 323),
        ("American English", 311, 312, "reference", 324, 325),
        ("Additional exercises 1–41: mixed grammar practice", 313, 336, "practice", 292, 315),
        ("Study guide: diagnostic grammar review", 337, 346, "practice"),
    ],
    "grammar-advanced": [
        ("Irregular verbs", 213, 214, "reference"),
        ("Passive verb forms", 215, 215, "reference"),
        ("Glossary of grammar terminology", 216, 220, "reference"),
        ("Study planner: diagnostic review", 221, 232, "practice"),
        ("Grammar reminder", 233, 250, "reference"),
        ("Additional exercises", 251, 261, "practice"),
    ],
    "phrasal-intermediate": [("Mini dictionary of phrasal verbs", 179, 202, "reference")],
    "phrasal-advanced": [("Mini dictionary of phrasal verbs", 166, 194, "reference")],
    "vocabulary-advanced": [("Phonemic symbols: vowels, consonants and word stress", 278, 278, "reference")],
    "vocabulary-elementary": [("Phonemic symbols: vowels, consonants and word stress", 159, 159, "reference")],
    "vocabulary-upper-intermediate": [("Phonemic symbols: vowels, consonants and word stress", 258, 258, "reference")],
}


def normalize_chart(text):
    # Supplemental phonemic pages use additional glyph codes not present in
    # numbered lessons. Mappings were checked against the visible Advanced
    # chart; Elementary/Upper have visibly missing glyphs in the PDF itself.
    return text.translate(str.maketrans({"υ": "ʊ", "\ue0c6": "ɜ", "\ue05a": "ʒ", "\ue07b": "æ", "\ue0f6": "ʌ"}))


def phonemic_rows(page):
    """Recover each unruled chart column by baseline, including mixed fonts."""
    columns = [[], []]
    changes = {"splitLigaturesRepaired": 0, "verifiedFontGlyphsRepaired": 0}
    for block in page.get_text("dict", flags=pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES)["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                value = normalize_chart(clean_text(span_text(span, changes), changes))
                if value:
                    columns[int(span["origin"][0] > page.rect.width * .52)].append({"text": value, "x": span["origin"][0], "end": span["bbox"][2], "y": span["origin"][1]})
    tables = []
    for label, spans in zip(("Vowel sounds", "Consonant sounds"), columns):
        rows = []
        for span in sorted(spans, key=lambda s: (s["y"], s["x"])):
            found = next((row for row in rows if abs(row[0]["y"] - span["y"]) <= 3), None)
            if found is None:
                rows.append([span])
            else:
                found.append(span)
        parsed = []
        for row in rows:
            ordered = sorted(row, key=lambda s: s["x"])
            value = ""
            last_end = None
            for s in ordered:
                if last_end is not None and s["x"] - last_end > 1.3:
                    value += " "
                value += s["text"]
                last_end = s["end"]
            match = re.match(r"^(/[^/]+/)\s*(.+)$", value)
            if match:
                symbol = match[1].replace(" ", "")
                entry = {"symbol": symbol, "examples": match[2]}
                if symbol == "/ae/":
                    # The Elementary chart uses two literal letters for the
                    # same cat/black vowel shown as æ in the supplied Advanced
                    # chart. Keep the source form while exposing Unicode IPA.
                    entry.update({"symbol": "/æ/", "sourceSymbol": "/ae/", "normalization": "legacy ligature rendered as Unicode IPA"})
                parsed.append(entry)
        tables.append({"title": label, "rows": parsed})
    assert len(tables[0]["rows"]) >= 20 and len(tables[1]["rows"]) == 24, tables
    return tables


def main():
    catalog = json.loads((ROOT / "app/content/library.json").read_text(encoding="utf8"))
    books = {b["id"]: b for b in catalog["books"]}
    docs = {}
    hashes = {}
    indexed, extracted = [], []
    for b in catalog["books"]:
        item = {"bookId": b["id"], "filename": b["filename"], "entries": []}
        if b.get("duplicateOf"):
            item["duplicateOf"] = b["duplicateOf"]
            item["note"] = "Equivalent edition. Its clean source pages are mapped to the primary book entries; no duplicate curriculum entries."
        for n, definition in enumerate(DEFINITIONS.get(b["id"], []), 1):
            title, start, end, kind = definition[:4]
            entry_id = f"{b['id']}-appendix-{n:02d}"
            entry = {"id": entry_id, "title": title, "page": start, "endPage": end, "type": kind}
            assert 1 <= start <= end <= b["pdfPageCount"]
            item["entries"].append(entry)
            if b["source"] == "ocr-and-visual-toc":
                continue
            text_book = books["grammar-intermediate-ebook"] if len(definition) == 6 else b
            text_start, text_end = definition[4:] if len(definition) == 6 else (start, end)
            for source_book in (b, text_book):
                if source_book["id"] not in docs:
                    filename = pdf_source_path(ROOT / "книги", source_book["filename"])
                    docs[source_book["id"]] = pymupdf.open(filename)
                    hashes[source_book["id"]] = hashlib.sha256(filename.read_bytes()).hexdigest()
            page_texts = []
            is_chart = title.startswith("Phonemic symbols")
            for offset, number in enumerate(range(text_start, text_end + 1)):
                result = extract_page(docs[text_book["id"]][number - 1], text_book["id"])
                if is_chart:
                    chart = phonemic_rows(docs[text_book["id"]][number - 1])
                    result["text"] = normalize_chart(result["text"])
                    for block in result["blocks"]:
                        block["text"] = normalize_chart(block["text"])
                    result["quality"]["unmappedGlyphCount"] = len(re.findall(r"[\ufffd\ue000-\uf8ff]", result["text"]))
                    result["quality"]["warnings"] = [w for w in result["quality"]["warnings"] if w != "unmapped_glyphs"]
                    result["phonemicTables"] = chart
                    stress_notes = [part for part in result["text"].split("\n\n") if part.startswith(("ˈ", "ˌ"))]
                    result["text"] = "Phonemic symbols\n\n" + "\n\n".join(t["title"] + "\nSymbol | Examples\n" + "\n".join(row["symbol"] + " | " + row["examples"] for row in t["rows"]) for t in chart)
                    result["text"] += "\n\n" + "\n\n".join(stress_notes)
                    result["quality"]["tableCount"] = 2
                    result["quality"]["characters"] = len(result["text"])
                page_texts.append({"page": start + offset, "sourcePage": number, **result})
            text = "\n\n".join(p["text"] for p in page_texts)
            warnings = sorted({w for p in page_texts for w in p["quality"]["warnings"]})
            if text_book["id"] != b["id"]:
                warnings.append("equivalent_clean_ebook_replaces_damaged_ocr_layer")
            if b["id"] == "grammar-intermediate" and text_book["id"] == b["id"]:
                warnings.append("older_ocr_layer_requires_source_check")
            if is_chart and b["id"] != "vocabulary-advanced":
                warnings.append("original_pdf_has_missing_font_glyphs_ascii_codes_decoded")
            record = {
                "schemaVersion": 1, "unitId": entry_id, "bookId": b["id"], "title": title,
                "pages": [start, end], "type": kind, "source": "text-layer-layout", "text": text,
                "pageTexts": page_texts,
                "provenance": {"filename": b["filename"], "sha256": hashes[b["id"]],
                               "textFilename": text_book["filename"], "textBookId": text_book["id"],
                               "textPages": [text_start, text_end], "textSha256": hashes[text_book["id"]],
                               "extractor": "PyMuPDF " + pymupdf.VersionBind},
                "quality": {"characters": len(text), "words": len(text.split()), "pageCount": len(page_texts),
                            "tableCount": sum(p["quality"]["tableCount"] for p in page_texts),
                            "unmappedGlyphCount": sum(p["quality"]["unmappedGlyphCount"] for p in page_texts),
                            "warnings": warnings, "manuallyReviewed": is_chart,
                            "status": "needs-source-check" if "older_ocr_layer_requires_source_check" in warnings else "extracted"},
            }
            atomic_json(OUT / (entry_id + ".json"), record)
            extracted.append({"id": entry_id, "pages": record["pages"], "quality": record["quality"]})
            print(entry_id, len(text), flush=True)
        indexed.append(item)
    index = {"schemaVersion": 1, "books": indexed,
             "note": "Teaching/reference sections outside numbered units. Practice ranges revisit existing topics and are not counted as new thematic units. Answer keys, ordinary indexes and publisher credits are excluded.",
             "entryCount": sum(len(b["entries"]) for b in indexed)}
    atomic_json(INDEX, index)
    report = {"entryCount": index["entryCount"], "textExtracted": len(extracted), "entries": extracted,
              "scannedEntryIds": [e["id"] for b in indexed if books[b["bookId"]]["source"] == "ocr-and-visual-toc" for e in b["entries"]],
              "recommendations": [
                  "Link spelling, contractions, irregular-verb groups and tense/modal summary references from the respective lessons.",
                  "Use American English as a separate comparison reference; it contains differences spread across many numbered units.",
                  "Expose phonemic charts as a pronunciation reference, using decoded Unicode IPA instead of the PDF's legacy-font characters.",
                  "Keep 35 elementary / 41 intermediate additional exercise sets and Hewings mixed practice as review checkpoints, not inflated counts of new topics.",
                  "Use Study guide and Study planner for optional diagnostic review; glossary and mini dictionaries should be searchable reference material.",
              ]}
    atomic_json(ROOT / "app/data/book-supplements-report.json", report)
    print(json.dumps({"indexed": index["entryCount"], "extracted": len(extracted), "scanned": len(report["scannedEntryIds"])}))


if __name__ == "__main__":
    main()

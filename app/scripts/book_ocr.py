"""Resumable full-page OCR of the user's two scanned coursebooks.

Run with bundled Python and pypdfium2 on Windows. Outputs private per-unit JSON
under app/data/parsed-books; never changes the catalog or public book content.
Each worker owns one PDFium process and one persistent Windows OCR process.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import re
import statistics
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import pypdfium2 as pdfium
from book_ocr_fix import apply_corrections

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "app/data/parsed-books"
WORK = ROOT / "app/data/parsed-books-ocr-work"
REPORT = ROOT / "app/data/parsed-books-ocr-report.json"
VISUAL_REVIEW = ROOT / "app/data/parsed-books-ocr-visual-review.json"


def atomic_json(path: Path, value: object) -> None:
    temp = path.with_suffix(path.suffix + ".ocr.tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def reconstruct_rows(page: dict) -> None:
    """Reassemble split OCR columns into visual rows without guessing words.

    A tab denotes a substantial horizontal gap (table cell or answer blank).
    Original OCR order remains available in ocrText and full word rectangles.
    """
    words = [w for line in page.get("lines", []) for w in line.get("words", [])]
    if not words:
        return
    median_height = statistics.median(w["height"] for w in words)
    # Preserve recognized sentences as indivisible fragments. Splitting their
    # words solely by y breaks the slanted lines near a scanned book's spine.
    fragments = []
    for line in page.get("lines", []):
        line_words = line.get("words", [])
        if not line_words:
            continue
        centers = [w["y"] + w["height"] * .5 for w in line_words]
        vertical_span = max(centers) - min(centers)
        horizontal_span = max(w["x"] + w["width"] for w in line_words) - min(w["x"] for w in line_words)
        if vertical_span > median_height * 2 and horizontal_span < page["width"] * .25:
            # OCR commonly groups all exercise numbers into one vertical line.
            fragments.extend([[w] for w in line_words])
        else:
            fragments.append(line_words)
    rows = []
    for fragment in sorted(fragments, key=lambda ws: statistics.median(w["y"] + w["height"] * .5 for w in ws)):
        center = statistics.median(w["y"] + w["height"] * .5 for w in fragment)
        candidates = [r for r in rows[-4:] if abs(r["center"] - center) <= median_height * .55]
        if candidates:
            row = min(candidates, key=lambda r: abs(r["center"] - center))
            row["words"].extend(fragment)
            row["center"] = statistics.median(w["y"] + w["height"] * .5 for w in row["words"])
        else:
            rows.append({"center": center, "words": fragment[:]})
    visual_rows = []
    for row in sorted(rows, key=lambda r: r["center"]):
        ordered = sorted(row["words"], key=lambda w: w["x"])
        cells, current, previous = [], [], None
        for word in ordered:
            gap = word["x"] - previous["x"] - previous["width"] if previous else 0
            if gap > median_height * 1.6 and current:
                cells.append(" ".join(current))
                current = []
            current.append(word["text"])
            previous = word
        if current:
            cells.append(" ".join(current))
        visual_rows.append({"y": round(row["center"], 2), "cells": cells,
                            "text": "\t".join(cells)})
    page["ocrText"] = page.get("ocrText", page["text"])
    page["layoutRows"] = visual_rows
    page["layoutText"] = "\n".join(row["text"] for row in visual_rows)
    page["text"] = page["layoutText"]


def enrich_layout(books: list[dict]) -> None:
    review = json.loads(VISUAL_REVIEW.read_text(encoding="utf-8")) if VISUAL_REVIEW.exists() else {"samples": []}
    reviewed = {sample["unitId"]: sample for sample in review["samples"]}
    for book in books:
        for unit in book["units"]:
            path = OUTPUT / (unit["id"] + ".json")
            if not path.exists():
                continue
            content = json.loads(path.read_text(encoding="utf-8-sig"))
            for page in content["pageTexts"]:
                reconstruct_rows(page)
            content["text"] = "\n\n".join(p["text"] for p in content["pageTexts"])
            content["quality"]["readingOrder"] = "Geometric top-to-bottom rows, left-to-right words; tabs preserve large gaps. Original ocrText, OCR lines and word rectangles are retained. Complex tables require source verification."
            content["quality"]["characterCount"] = len(content["text"])
            content["quality"]["status"] = "ocr-unverified"
            if unit["id"] in reviewed:
                sample = reviewed[unit["id"]]
                content["quality"]["visualReview"] = sample
                content["quality"]["status"] = "review-found-errors" if sample["issues"] else "sample-reviewed"
                # A sampled comparison is never represented as a full proofread.
                content["quality"]["visualVerified"] = False
                for issue in sample["issues"]:
                    if issue not in content["quality"]["issues"]:
                        content["quality"]["issues"].append(issue)
            atomic_json(path, content)


def complete_unit(path: Path, expected_pages: int) -> bool:
    if not path.exists():
        return False
    try:
        unit = json.loads(path.read_text(encoding="utf-8-sig"))
        return (unit.get("source") == "ocr" and unit.get("quality", {}).get("complete")
                and len(unit.get("pageTexts", [])) == expected_pages)
    except (OSError, ValueError):
        return False


def process_book(book: dict, dpi: int, limit: int | None, force: bool) -> dict:
    directory = WORK / book["id"]
    directory.mkdir(parents=True, exist_ok=True)
    document = pdfium.PdfDocument(str(ROOT / "книги" / book["filename"]))
    units = []
    for unit in book["units"][:limit]:
        output_path = OUTPUT / (unit["id"] + ".json")
        if not force and complete_unit(output_path, unit["endPage"] - unit["page"] + 1):
            continue
        rendered = []
        for number in range(unit["page"], unit["endPage"] + 1):
            image_path = directory / f"page-{number:03d}.png"
            page = document[number - 1]
            # Stay conservatively below Windows OCR's limit even on older builds.
            scale = min(dpi / 72, 4096 / max(page.get_size()))
            bitmap = page.render(scale=scale)
            image = bitmap.to_pil()
            image.save(image_path, compress_level=2)
            image.close()
            bitmap.close()
            page.close()
            rendered.append({"page": number, "path": str(image_path)})
        units.append({"unitId": unit["id"], "bookId": book["id"], "title": unit["title"],
                      "startPage": unit["page"], "endPage": unit["endPage"],
                      "renderedPages": rendered, "outputPath": str(output_path)})
        if len(units) % 10 == 0:
            print(f"Rendered {book['id']}: {len(units)} full units", flush=True)
    document.close()
    if units:
        manifest = directory / "manifest.json"
        atomic_json(manifest, {"bookId": book["id"], "renderDpi": dpi, "units": units})
        result = subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
                                 "-File", str(ROOT / "app/scripts/book_ocr.ps1"),
                                 "-ManifestPath", str(manifest)], check=False)
        if result.returncode:
            raise RuntimeError(f"OCR worker {book['id']} exited {result.returncode}")
    return {"bookId": book["id"], "processed": len(units)}


def write_report(books: list[dict]) -> dict:
    book_reports = []
    for book in books:
        summaries = []
        missing = []
        for unit in book["units"]:
            path = OUTPUT / (unit["id"] + ".json")
            if not path.exists():
                missing.append(unit["id"])
                continue
            content = json.loads(path.read_text(encoding="utf-8-sig"))
            summaries.append({"unitId": unit["id"], "pages": content["pages"],
                              "characters": len(content["text"]),
                              "pageCharacters": [len(p["text"]) for p in content["pageTexts"]],
                              "quality": content["quality"], "corrections": content.get("corrections", [])})
        book_reports.append({"bookId": book["id"], "filename": book["filename"],
                             "expectedUnits": len(book["units"]), "extractedUnits": len(summaries),
                             "extractedPages": sum(len(s["pageCharacters"]) for s in summaries),
                             "missing": missing, "units": summaries})
    report = {"createdAt": datetime.now(timezone.utc).isoformat(),
              "scope": "All pages of all numbered teaching units in both scanned books; appendices and answer keys are outside this unit extraction.",
              "books": book_reports, "unitCount": sum(b["extractedUnits"] for b in book_reports),
              "pageCount": sum(b["extractedPages"] for b in book_reports)}
    if VISUAL_REVIEW.exists():
        report["visualReview"] = json.loads(VISUAL_REVIEW.read_text(encoding="utf-8"))
    report["complete"] = all(not b["missing"] for b in book_reports)
    report["emptyPages"] = sum(count == 0 for b in book_reports for u in b["units"] for count in u["pageCharacters"])
    report["characterCount"] = sum(u["characters"] for b in book_reports for u in b["units"])
    report["correctionSummary"] = {"units": sum(bool(u["corrections"]) for b in book_reports for u in b["units"]),
                                    "pages": len({(u["unitId"], c["page"]) for b in book_reports for u in b["units"] for c in u["corrections"]}),
                                    "groups": sum(len(u["corrections"]) for b in book_reports for u in b["units"])}
    report["limitations"] = ["This is full scanned unit extraction, not a claim of complete manual proofreading.",
                             "OCR does not reliably preserve strike-through, handwriting-like fonts, IPA or table semantics.",
                             "No answer key is inferred from exercise text. The original PDF remains authoritative."]
    atomic_json(REPORT, report)
    print(f"Report: {report['unitCount']} units, {report['pageCount']} pages", flush=True)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--dpi", type=int, default=216)
    parser.add_argument("--limit", type=int, help="Preview only: units per book")
    parser.add_argument("--book", help="Process one catalog book id")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--report-only", action="store_true")
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    catalog = json.loads((ROOT / "app/content/library.json").read_text(encoding="utf-8"))
    books = [b for b in catalog["books"] if b["source"] == "ocr-and-visual-toc"]
    selected = [b for b in books if not args.book or b["id"] == args.book]
    if not args.report_only:
        with concurrent.futures.ProcessPoolExecutor(max_workers=min(args.workers, len(selected))) as pool:
            futures = [pool.submit(process_book, b, args.dpi, args.limit, args.force) for b in selected]
            for future in concurrent.futures.as_completed(futures):
                print(future.result(), flush=True)
    enrich_layout(books)
    apply_corrections()
    write_report(books)


if __name__ == "__main__":
    main()

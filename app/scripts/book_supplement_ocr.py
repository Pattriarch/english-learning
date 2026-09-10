"""Full-page OCR of substantive endmatter in the two scanned user PDFs."""
import concurrent.futures
import json
from pathlib import Path

import book_ocr

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "app/data/parsed-book-supplements"
WORK = ROOT / "app/data/parsed-book-supplements-ocr-work"
REPORT = ROOT / "app/data/parsed-book-supplements-ocr-report.json"


def configure() -> None:
    book_ocr.OUTPUT = OUTPUT
    book_ocr.WORK = WORK
    book_ocr.REPORT = REPORT


def worker(book: dict) -> dict:
    configure()
    return book_ocr.process_book(book, 216, None, False)


def dictionary_columns(page: dict) -> None:
    """Read the visually confirmed three-column mini dictionary by column."""
    columns = [[], [], []]
    headers, footers = [], []
    for line in page["lines"]:
        words = line["words"]
        if not words:
            continue
        x = min(w["x"] for w in words)
        y = min(w["y"] for w in words)
        width = max(w["x"] + w["width"] for w in words) - x
        if y > page["height"] * .93:
            footers.append(line)
        elif y < page["height"] * .12 and (width > page["width"] * .45 or "Mini dictionary" in line["text"]):
            headers.append(line)
        else:
            index = 0 if x < page["width"] * .25 else 1 if x < page["width"] * .55 else 2
            columns[index].append(line)
    parts = []
    column_texts = []
    for index, lines in enumerate([headers, *columns, footers]):
        if not lines:
            continue
        section = {"lines": lines, "width": page["width"], "height": page["height"], "text": ""}
        book_ocr.reconstruct_rows(section)
        parts.append(section["text"])
        if 1 <= index <= 3:
            column_texts.append({"column": index, "text": section["text"]})
    page["rowLayoutText"] = page["layoutText"]
    page["columnTexts"] = column_texts
    page["text"] = "\n\n".join(parts)
    page["layoutText"] = page["text"]
    page["readingOrder"] = "Header, left column top-to-bottom, middle column, right column, footer. Three-column layout visually verified on original dictionary pages."


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    index = json.loads((ROOT / "app/content/book-supplements.json").read_text(encoding="utf-8"))
    selected = []
    for book in index["books"]:
        if book["bookId"] not in {"grammar-advanced", "phrasal-intermediate"}:
            continue
        selected.append({"id": book["bookId"], "filename": book["filename"],
                         "units": [{"id": e["id"], "title": e["title"], "page": e["page"],
                                    "endPage": e["endPage"], "type": e["type"]} for e in book["entries"]]})
    with concurrent.futures.ProcessPoolExecutor(max_workers=2) as pool:
        for result in pool.map(worker, selected):
            print(result, flush=True)
    configure()
    book_ocr.enrich_layout(selected)
    for book in selected:
        for unit in book["units"]:
            path = OUTPUT / (unit["id"] + ".json")
            record = json.loads(path.read_text(encoding="utf-8"))
            if unit["id"] == "phrasal-intermediate-appendix-01":
                for page in record["pageTexts"]:
                    dictionary_columns(page)
                record["text"] = "\n\n".join(p["text"] for p in record["pageTexts"])
                record["quality"]["characterCount"] = len(record["text"])
                record["quality"]["readingOrder"] = "Three dictionary columns separately, left to right; original OCR, geometric rows and word boxes retained."
            record["schemaVersion"] = 1
            record["type"] = unit["type"]
            record["provenance"] = {"filename": book["filename"], "sourcePath": str(Path("книги") / book["filename"]),
                                    "pdfPages": list(range(unit["page"], unit["endPage"] + 1)),
                                    "extraction": "full-page Windows OCR, 216 dpi; geometric reading order with original OCR retained",
                                    "index": "app/content/book-supplements.json", "ownership": "user-supplied-local-pdf"}
            book_ocr.atomic_json(path, record)
    report = book_ocr.write_report(selected)
    report["scope"] = "All pages of all seven substantive endmatter sections indexed for the two scanned books, excluding their answer keys."
    report["sectionCount"] = report.pop("unitCount")
    report.pop("visualReview", None)
    book_ocr.atomic_json(REPORT, report)
    print(f"Full supplements: {report['sectionCount']} sections, {report['pageCount']} pages, {report['characterCount']} characters", flush=True)


if __name__ == "__main__":
    main()

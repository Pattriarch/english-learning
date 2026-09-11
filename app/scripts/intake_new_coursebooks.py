"""Private, resumable full-page intake of six supplied American-English books.

No UI/catalog publication, model calls or modification of original PDFs. Every
physical PDF page is retained, including frontmatter and appendices. OCR is
performed per page to make interruptions resumable. Run --extract before
--assemble (the latter uses the reviewed public chapter manifest).
"""
from __future__ import annotations
import argparse
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import tempfile

import pymupdf
from book_source_contract import pdf_source_path
from book_ocr import reconstruct_rows

APP = Path(__file__).resolve().parents[1]
ROOT = APP.parent
OUT = APP / "data/new-coursebooks"
BOOKS = {
    "clear-speech-3": "Clear_Speech.pdf",
    "great-writing-1-4": "Great_Writing_1_Student_Book_4th_Edition-2.pdf",
    "great-writing-2-4": "Great_Writing_2_Student_Book_4th_Edition.pdf",
    "great-writing-3-3": "Great_Writing_3_-_Student_39_s_Book.pdf",
    "great-writing-4-4": "Great_Writing_4_Student_39_s_Book.pdf",
    "viewpoint-1": "Viewpoint_1_SB.pdf",
}
COMPANION_FILES = {
    "great-writing-3-key": "Great_Writing_3_-_Answer_Key.pdf",
    "great-writing-3-notes": "Great_Writing_3_-_Teacher_39_s_Notes.pdf",
    "great-writing-4-key": "Great_Writing_4_Answer_Key.pdf",
    "great-writing-4-notes": "Great_Writing_4_Teacher_39_s_Notes.pdf",
    "viewpoint-1-te": "Viewpoint_1_TE.pdf",
    "viewpoint-1-workbook": "Viewpoint_1_workbook.pdf",
    "viewpoint-1-cefr": "Viewpoint_1_CEFR_Guide.pdf",
    "viewpoint-1-video-worksheets": "Viewpoint_1_video_activity_worksheets.pdf",
    "viewpoint-2-workbook": "viewpoint_2_workbook.pdf",
}


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.stem + "-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def extract_book(identifier):
    filename = "more/" + {**BOOKS, **COMPANION_FILES}[identifier]
    pdf = pdf_source_path(ROOT / "книги", filename)
    digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
    folder = OUT / identifier
    images, ocr = folder / "images", folder / "ocr"
    images.mkdir(parents=True, exist_ok=True)
    ocr.mkdir(parents=True, exist_ok=True)
    with pymupdf.open(pdf) as document:
        page_count = len(document)
        identity = {"bookId": identifier, "filename": filename, "sha256": digest, "pdfPageCount": page_count}
        previous = folder / "identity.json"
        if previous.exists() and read_json(previous) != identity:
            raise ValueError("Source PDF identity changed; preserve old intake and use a new edition ID")
        atomic_json(previous, identity)
        native = []
        work = []
        for index, page in enumerate(document):
            number = index + 1
            image_path = images / f"{number}.jpg"
            if not image_path.exists():
                pix = page.get_pixmap(dpi=160, alpha=False)
                temporary = image_path.with_suffix(".tmp.jpg")
                temporary.write_bytes(pix.tobytes("jpg", jpg_quality=90))
                os.replace(temporary, image_path)
            native.append({"page": number, "text": page.get_text("text", sort=True)})
            path = ocr / f"{number}.json"
            ready = False
            if path.exists():
                try:
                    record = read_json(path)
                    ready = record.get("pages") == [number] and len(record.get("pageTexts", [])) == 1 and not record["pageTexts"][0].get("error")
                except (ValueError, OSError, KeyError):
                    pass
            if not ready:
                work.append({"unitId": f"{identifier}-page-{number:03d}", "bookId": identifier,
                             "title": f"Physical PDF page {number}", "startPage": number, "endPage": number,
                             "renderedPages": [{"page": number, "path": str(image_path)}], "outputPath": str(path)})
        atomic_json(folder / "native-pages.json", native)
        print(f"RENDERED {identifier} {page_count} pages; OCR remaining {len(work)}", flush=True)
        if work:
            manifest = folder / "ocr-work.json"
            atomic_json(manifest, {"bookId": identifier, "renderDpi": 160, "units": work})
            log_path = folder / "ocr.log"
            with log_path.open("a", encoding="utf-8") as log:
                result = subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                                         str(APP / "scripts/book_ocr.ps1"), "-ManifestPath", str(manifest)],
                                        stdout=log, stderr=subprocess.STDOUT, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if result.returncode:
                raise RuntimeError(f"OCR failed for {identifier}; inspect {log_path}")
    records = []
    for page in native:
        number = page["page"]
        raw = read_json(ocr / f"{number}.json")
        scanned = raw["pageTexts"][0]
        reconstruct_rows(scanned)
        # Preserve both representations; the page image remains authoritative.
        records.append({"page": number, "nativeText": page["text"], "ocrText": scanned.get("ocrText", ""),
                        "layoutText": scanned.get("layoutText", ""), "text": scanned.get("text", ""),
                        "lines": scanned.get("lines", []), "layoutRows": scanned.get("layoutRows", []),
                        "width": scanned.get("width"), "height": scanned.get("height"),
                        "error": scanned.get("error"), "image": f"{identifier}/images/{number}.jpg",
                        "imageSHA256": hashlib.sha256((images / f"{number}.jpg").read_bytes()).hexdigest()})
    atomic_json(folder / "pages.json", {**identity, "pages": records, "extractedAt": datetime.now(timezone.utc).isoformat(),
        "quality": {"pages": len(records), "errors": [p["page"] for p in records if p["error"]],
                    "sparsePages": [p["page"] for p in records if len(p["text"].strip()) < 120],
                    "visualReviewed": False, "source": "Full-page Windows OCR; original rows, native text and page images retained."}})
    print(f"EXTRACTED {identifier}: {len(records)} pages", flush=True)
    return {"bookId": identifier, "pages": len(records), "errors": sum(bool(p["error"]) for p in records)}


def section_candidates(unit, page_texts, kind):
    candidates=[]
    pattern=(r"^(?:Lesson\s+[A-D]\b.{0,90}|Vocabulary notebook)$" if kind=="integrated-conversation" else
             r"^(?:What Is (?:a Sentence|a Paragraph|an Essay|a (?:Definition|Process|Descriptive|Opinion|Narrative|Cause-Effect) Paragraph|"
             r"a (?:Narrative|Comparison|Cause-Effect) Essay|an Argument Essay|in the Introduction)\?|"
             r"(?:Four|Five|Three) (?:Features|Elements|Parts) of (?:a (?:Well-Written |Good Topic |Good )?(?:Paragraph|Sentence)|Good Writing)|"
             r"Working with (?:Paragraphs|Ideas for Narrative|Language|the Structure of a Paragraph)|"
             r"Parts of (?:a Sentence: Subjects, Verbs, and Objects|a Paragraph(?::.{0,50})?|a Prepositional Phrase \(of Place\))|"
             r"Building Better Vocabulary|Original Student Writing(?::.{0,70})?|Timed Writing|"
             r"Writing (?:the (?:Introduction|Body|Conclusion)|a Cause-Effect Paragraph|a Response to Topics in the News)|"
             r"Developing (?:a (?:Narrative|Comparison|Cause-Effect) Essay|an Argument Essay)|The (?:Introduction|Body|Conclusion))$")
    for page in page_texts:
        for line in page["text"].splitlines():
            heading=line.strip()
            if re.match(pattern,heading,re.I) and len(heading)<125:
                # Suggestions preserve actual heading text and page, never
                # manufacture sections based solely on a fixed page count.
                candidates.append({"page":page["page"],"heading":heading})
    by_page={}
    for candidate in candidates:
        by_page.setdefault(candidate["page"],[]).append(candidate["heading"])
    starts=sorted({unit["page"],*by_page})
    return [{"page":page,"endPage":starts[i+1]-1 if i+1<len(starts) else unit["endPage"],
             "headings":by_page.get(page,[unit["title"]]),"status":"source-heading-candidate; confirm conceptual boundary before lesson generation"}
            for i,page in enumerate(starts)]


def assemble():
    manifest=read_json(APP/"content/new-coursebooks-intake.json")
    summary=[]
    for book in manifest["books"]:
        source=read_json(OUT/book["id"]/"pages.json")
        if source["sha256"]!=book["sha256"] or source["pdfPageCount"]!=book["pdfPageCount"]:
            raise ValueError("Manifest/source identity mismatch")
        by_page={p["page"]:p for p in source["pages"]}
        for unit in book["units"]+book["supplements"]:
            pages=[]
            for number in unit["pages"]:
                page=by_page[number]
                if page.get("error"): raise ValueError(f"OCR error on {book['id']}:{number}")
                pages.append({"page":number,"sourcePage":number,"text":page["text"],
                              "printedPage":unit["printedPage"]+number-unit["page"]})
            text="\n\n".join(p["text"] for p in pages)
            images=[{"page":n,"path":by_page[n]["image"],"sha256":by_page[n]["imageSHA256"]} for n in unit["pages"]]
            record={"schemaVersion":1,"unitId":unit["id"],"bookId":book["id"],"title":unit["title"],
                    "pages":unit["pages"],"source":"ocr","text":text,"pageTexts":pages,
                    "provenance":{"filename":book["filename"],"sha256":book["sha256"],"edition":book["edition"],
                                  "sourceHash":hashlib.sha256(text.encode("utf-8")).hexdigest(),"sourceImages":images},
                    "quality":{"pageCount":len(pages),"characters":len(text),"completePageInventory":True,
                               "manualTextProofreading":False,"chapterBoundaryVisuallyVerified":unit in book["units"],
                               "warnings":["OCR may misread IPA, word stress, handwriting, tables and corrections; verify each attached image.",
                                           "All source pages preserved. Full OCR is not a claim of full semantic editorial review."]},
                    "companionRefs":unit.get("companionRefs",[]),
                    "companionUnits":unit.get("companionUnits",[]),"audioTracks":unit.get("audioTracks",[]),
                    "studentSupplementPages":unit.get("studentSupplementPages",{}),"teacherSupplementPages":unit.get("teacherSupplementPages",{}),
                    "sectionCandidates":section_candidates(unit,pages,book["kind"])}
            category="units" if unit in book["units"] else "supplements"
            atomic_json(OUT/category/(unit["id"]+".json"),record)
            summary.append({"id":unit["id"],"bookId":book["id"],"category":category,"pages":len(pages),
                            "characters":len(text),"sectionCandidates":record["sectionCandidates"],
                            "sourceFile":f"{category}/{unit['id']}.json"})
    atomic_json(OUT/"source-index.json",{"units":summary,"studentBooks":len(manifest["books"]),
                 "majorUnits":sum(r["category"]=="units" for r in summary),"supplements":sum(r["category"]=="supplements" for r in summary)})
    print(json.dumps({"assembled":len(summary),"majorUnits":sum(r["category"]=="units" for r in summary)}),flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extract", action="store_true")
    parser.add_argument("--assemble", action="store_true")
    parser.add_argument("--companions", action="store_true")
    parser.add_argument("--book", choices=list(BOOKS)+list(COMPANION_FILES))
    parser.add_argument("--workers", type=int, default=3)
    args = parser.parse_args()
    if args.extract:
        with ProcessPoolExecutor(max_workers=args.workers) as pool:
            result = list(pool.map(extract_book, [args.book] if args.book else list(COMPANION_FILES if args.companions else BOOKS)))
        atomic_json(OUT / ("companion-extraction-summary.json" if args.companions else "extraction-summary.json"), result)
        print(json.dumps(result), flush=True)
    if args.assemble:
        assemble()


if __name__ == "__main__":
    main()

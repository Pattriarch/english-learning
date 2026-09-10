"""Validate a portable inventory of original book lessons, without publishing PDFs.

    python app/scripts/publish_book_release.py --check
    python app/scripts/publish_book_release.py

Only book-release.json is written. Private source JSON and page JPEGs are read
locally, never copied into the release. Pending (absent) lessons stay pending.
This does not run a model, modify progress, stage Git files, or push anything.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile

# Reuse the generation pipeline's content-depth/coverage checks without running
# it or writing any of its inputs or outputs. Its entry point is main-guarded.
from build_book_lessons import validate_lesson

APP = Path(__file__).resolve().parents[1]
SAFE_ID = re.compile(r"[a-zA-Z0-9_-]{1,100}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")


def read_json(path):
    raw = Path(path).read_bytes()
    if len(raw) > 8 << 20:
        raise ValueError("JSON exceeds the runtime's 8 MiB limit")
    return raw, json.loads(raw.decode("utf-8"))


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def catalog_units(path):
    _, catalog = read_json(path)
    result = {}
    for book in catalog["books"]:
        if book.get("duplicateOf"):
            continue
        if not SAFE_ID.fullmatch(book["id"]):
            raise ValueError("Unsafe book ID")
        for unit in book["units"]:
            identifier = unit["id"]
            if not SAFE_ID.fullmatch(identifier) or identifier in result:
                raise ValueError("Unsafe or duplicate unit ID")
            result[identifier] = {"bookId": book["id"], "pages": [unit["page"], unit["endPage"]]}
    return result


def validate_unit(identifier, entry, lesson_path, sources, images):
    raw, lesson = read_json(lesson_path)
    _, source = read_json(Path(sources) / f"{identifier}.json")
    provenance = lesson.get("provenance", {})
    if (lesson.get("id") != "book-" + identifier or provenance.get("unitId") != identifier
            or provenance.get("bookId") != entry["bookId"] or provenance.get("pages") != entry["pages"]
            or source.get("unitId") != identifier or source.get("bookId") != entry["bookId"]
            or source.get("pages") != entry["pages"]):
        raise ValueError("Catalog/source/lesson identity or pages disagree")
    text = source.get("text")
    if not isinstance(text, str) or not text.strip() or source.get("source") not in ("text-layer-layout", "ocr"):
        raise ValueError("Private source is empty or unrecognised")
    source_hash = digest(text.encode("utf-8"))
    if provenance.get("sourceHash") != source_hash or provenance.get("source") != source["source"]:
        raise ValueError("Lesson source hash or extraction method changed")
    visual = provenance.get("visualSourceUsed", False)
    if not isinstance(visual, bool):
        raise ValueError("Invalid visualSourceUsed flag")
    source_images = provenance.get("sourceImages", [])
    if not isinstance(source_images, list) or (not visual and source_images):
        raise ValueError("Unverified source-image metadata")
    if visual:
        if len(source_images) != 2:
            raise ValueError("Both source pages are required")
        for page, image in zip(entry["pages"], source_images):
            if image.get("page") != page or not SHA256.fullmatch(image.get("sha256", "")):
                raise ValueError("Incorrect source-image page/hash")
            image_path = Path(images) / entry["bookId"] / f"{page}.jpg"
            image_bytes = image_path.read_bytes()
            if not image_bytes.startswith(b"\xff\xd8") or not image_bytes.endswith(b"\xff\xd9"):
                raise ValueError("Incomplete source JPEG")
            if digest(image_bytes) != image["sha256"]:
                raise ValueError("Source-page image changed")
    validate_lesson(lesson, entry["pages"] if visual else None)
    # The generator publishes atomically and may be running. Never attest bytes
    # of a replaced lesson accidentally; a later replacement simply needs a new
    # snapshot and is rejected by the old manifest in a source-free clone.
    if Path(lesson_path).read_bytes() != raw:
        raise ValueError("Lesson changed during validation; rerun the publisher")
    return {"lessonId": lesson["id"], "bookId": entry["bookId"], "pages": entry["pages"],
            "lessonSHA256": digest(raw), "source": source["source"], "sourceHash": source_hash,
            "visualSourceUsed": visual,
            **({"sourceImages": [{"page": image["page"], "sha256": image["sha256"]} for image in source_images]} if visual else {})}


def build_release(content, sources, images):
    content = Path(content)
    catalog = catalog_units(content / "library.json")
    units, rejected = {}, {}
    for path in sorted((content / "book-lessons").glob("*.json")):
        identifier = path.stem
        try:
            if identifier not in catalog:
                raise ValueError("Lesson is not a canonical catalog unit")
            units[identifier] = validate_unit(identifier, catalog[identifier], path, sources, images)
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
            # Report only the reason, never parsed textbook contents.
            rejected[identifier] = str(error)
    release = {"version": 1, "publishedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "total": len(catalog), "ready": len(units), "units": units}
    return release, rejected


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.stem + "-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--content", type=Path, default=APP / "content")
    parser.add_argument("--sources", type=Path, default=APP / "data/parsed-books")
    parser.add_argument("--images", type=Path, default=APP / "data/book-page-images")
    parser.add_argument("--output", type=Path, help="Default: <content>/book-release.json")
    parser.add_argument("--check", action="store_true", help="Validate only; write nothing")
    parser.add_argument("--skip-invalid", action="store_true", help="Explicitly publish only valid units when some existing lessons fail")
    args = parser.parse_args(argv)
    release, rejected = build_release(args.content, args.sources, args.images)
    summary = {"ready": release["ready"], "total": release["total"], "rejected": rejected,
               "written": False, "checkOnly": args.check}
    if not args.check and (not rejected or args.skip_invalid):
        atomic_json(args.output or args.content / "book-release.json", release)
        summary["written"] = True
    print(json.dumps(summary, ensure_ascii=True, indent=2))
    return 1 if rejected and not args.skip_invalid else 0


if __name__ == "__main__":
    sys.exit(main())

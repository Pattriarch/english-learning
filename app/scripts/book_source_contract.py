"""Shared private-PDF paths and complete teaching-unit page inventories.

Unit pages are an enumeration, not range endpoints. Two-page In Use records
therefore retain their original bytes; longer chapters cannot omit the middle.
Supplemental endmatter uses its own historical range schema and is not changed.
"""
from pathlib import Path
import re


def valid_pdf_name(name):
    if not isinstance(name, str) or not name.lower().endswith(".pdf") or re.search(r'[\\:<>"|?*\x00-\x1f\x7f]', name):
        return False
    for part in name.split("/"):
        if not part or part in (".", "..") or part.rstrip(" .") != part:
            return False
        if re.fullmatch(r"(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])", part.split(".", 1)[0], re.I):
            return False
    return True


def pdf_source_path(root, name):
    if not valid_pdf_name(name):
        raise ValueError("Unsafe relative PDF source path")
    root = Path(root).resolve(strict=True)
    target = (root / name).resolve(strict=True)
    if not target.is_relative_to(root) or not target.is_file():
        raise ValueError("PDF source must be a file inside the book directory")
    return target


def unit_pages(unit):
    start, end = unit.get("page"), unit.get("endPage")
    if type(start) is not int or type(end) is not int or start < 1 or end < start or end - start > 10000:
        raise ValueError("Invalid teaching-unit page range")
    pages = list(range(start, end + 1))
    if "pages" in unit and unit["pages"] != pages:
        raise ValueError("Explicit unit pages must contain every page in order")
    return pages


def source_pages(source, expected=None):
    pages = source.get("pages")
    if (not isinstance(pages, list) or not pages or len(pages) > 10001
            or any(type(page) is not int or page < 1 for page in pages)
            or any(page != pages[0] + i for i, page in enumerate(pages))):
        raise ValueError("Source pages must enumerate every page in order")
    if expected is not None and pages != expected:
        raise ValueError("Source pages disagree with the catalog")
    if "pageTexts" in source:
        texts = source["pageTexts"]
        if (not isinstance(texts, list) or any(not isinstance(page, dict) for page in texts)
                or [page.get("page") for page in texts] != pages):
            raise ValueError("Extracted page texts omit or reorder source pages")
    return pages

"""Apply private, visually verified OCR transcription corrections idempotently."""
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PATCHES = ROOT / "app/data/parsed-books-ocr-corrections.json"


def apply_corrections() -> dict:
    if not PATCHES.exists():
        return {"units": 0, "corrections": 0}
    manifest = json.loads(PATCHES.read_text(encoding="utf-8"))
    records = {}
    applied = 0
    for patch in manifest["corrections"]:
        unit_id = patch["unitId"]
        if unit_id not in records:
            path = ROOT / "app/data/parsed-books" / (unit_id + ".json")
            records[unit_id] = json.loads(path.read_text(encoding="utf-8"))
        record = records[unit_id]
        page = next(p for p in record["pageTexts"] if p["page"] == patch["page"])
        page.setdefault("rawLayoutText", page["layoutText"])
        before = page["text"]
        if patch["method"] == "section-between-markers":
            start = before.index(patch["start"]) + len(patch["start"])
            end = before.index(patch["end"], start)
            after = before[:start] + patch["replacement"] + before[end:]
        else:
            after = before
            for old, new in patch["replacements"]:
                if old not in after and new not in after:
                    raise ValueError(f"Neither original nor corrected text found: {patch['id']}: {old!r}")
                after = after.replace(old, new)
        page["text"] = after
        page["layoutText"] = after
        page["layoutRowsSource"] = "Uncorrected geometric OCR rows; text/layoutText include the listed manual corrections."
        provenance = {"id": patch["id"], "page": patch["page"], "method": patch["method"],
                      "sourceImage": patch["sourceImage"], "reason": patch["reason"],
                      "verifiedAt": "2026-09-10", "manifest": str(PATCHES.relative_to(ROOT))}
        existing = record.setdefault("corrections", [])
        if not any(p["id"] == patch["id"] for p in existing):
            existing.append(provenance)
        page["correctionIds"] = [p["id"] for p in existing if p["page"] == page["page"]]
        applied += 1
    for unit_id, record in records.items():
        record["text"] = "\n\n".join(p["text"] for p in record["pageTexts"])
        record["quality"]["characterCount"] = len(record["text"])
        record["quality"]["correctionCount"] = len(record["corrections"])
        record["quality"]["status"] = "sample-corrected"
        record["quality"]["correctionNote"] = "Listed sampled defects were corrected against page images. Other OCR text has not been fully proofread; raw OCR and geometric rows remain unchanged."
        path = ROOT / "app/data/parsed-books" / (unit_id + ".json")
        temp = path.with_suffix(".json.ocr-fix.tmp")
        temp.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        temp.replace(path)
    return {"units": len(records), "corrections": applied}


if __name__ == "__main__":
    print(apply_corrections())

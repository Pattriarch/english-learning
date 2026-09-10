"""Read-only heuristic triage of the 170 full OCR unit records.

This prioritizes visual review; it does not assert that unusual vocabulary is
wrong, nor silently correct any word. Uses the supplied text-layer books as an
in-domain reference lexicon and retains explicit example snippets in the report.
"""
import json
import re
import sys
import argparse
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.stdout.reconfigure(encoding="utf-8")
DATA = ROOT / "app/data/parsed-books"
OUT = ROOT / "app/data/parsed-books-ocr-corruption-audit.json"
WORD = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)?", re.UNICODE)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--annotate", action="store_true", help="Write only quality metadata; preserve every source text field")
    args = parser.parse_args()
    records = [json.loads(p.read_text(encoding="utf-8-sig")) for p in DATA.glob("*.json")]
    reference = Counter()
    for record in records:
        if record.get("source") != "ocr":
            reference.update(w.casefold() for w in WORD.findall(record.get("text", "")))
    ocr = [r for r in records if r.get("source") == "ocr"]
    corpus = Counter(w.casefold() for r in ocr for w in WORD.findall(r["text"]))
    page_results = []
    for record in ocr:
        for page in record["pageTexts"]:
            lines = [line.strip() for line in page["text"].splitlines() if line.strip()]
            candidates = []
            for index in range(len(lines)):
                segment = " ".join(lines[index:index + 2])
                if len(segment) < 45 or re.search(r"https?://|www\.|\.org|\.com", segment):
                    continue
                words = WORD.findall(segment)
                if len(words) < 8:
                    continue
                unknown = [w for w in words if len(w) >= 5 and w[:1].islower()
                           and reference[w.casefold()] == 0 and corpus[w.casefold()] <= 2]
                mixed = [w for w in words if re.search(r"[a-z][A-Z]|[A-Z][a-z]+[A-Z]", w)]
                unusual = [w for w in words if any(c.isalpha() and ord(c) > 127 for c in w)]
                fractured = re.findall(r"\b[a-z]\.[a-z]{3,}", segment)
                repeated = [w for w in words if re.search(r"([a-z])\1{3,}", w)]
                score = (len(unknown) / len(words) * 12 + len(mixed) * 1.3
                         + len(unusual) * .8 + len(fractured) * 1.5 + len(repeated) * 2)
                if (score >= 3.4 and len(unknown + mixed + unusual + fractured + repeated) >= 3):
                    candidates.append({"line": index + 1, "score": round(score, 2),
                                       "excerpt": segment[:450], "rareTokens": unknown,
                                       "mixedCaseTokens": mixed, "nonAsciiTokens": unusual,
                                       "fracturedTokens": fractured, "repeatedTokens": repeated})
            candidates.sort(key=lambda x: x["score"], reverse=True)
            # Avoid adjacent duplicate windows overwhelming the report.
            top = []
            for candidate in candidates:
                if all(abs(candidate["line"] - item["line"]) > 1 for item in top):
                    top.append(candidate)
                if len(top) == 5:
                    break
            role = "explanation" if page["page"] == record["pages"][0] else "exercises"
            score = top[0]["score"] if top else 0
            if len(page["text"]) < 700:
                score += 20
            if top or len(page["text"]) < 700:
                page_results.append({"unitId": record["unitId"], "page": page["page"],
                                     "role": role, "characters": len(page["text"]),
                                     "maxScore": round(score, 2),
                                     "priority": "high" if score >= 7 else "medium",
                                     "candidateWindows": len(candidates), "segments": top})
    page_results.sort(key=lambda r: (r["priority"] == "high", r["role"] == "explanation", r["maxScore"]), reverse=True)
    report = {"unitCount": len(ocr), "pageCount": sum(len(r["pageTexts"]) for r in ocr),
              "referenceLexiconWords": len(reference),
              "emptyOrShortPages": [r["unitId"] for r in page_results if r["characters"] < 700],
              "flaggedPages": len(page_results), "highPriorityPages": sum(r["priority"] == "high" for r in page_results),
              "method": "Heuristic rank combining rare lowercase words against the other supplied books, mixed case inside words, unexpected alphabetic characters and fractured words. No replacements or semantic assumptions.",
              "limitations": "Flags are candidates, not confirmed errors. Names, IPA, unfamiliar vocabulary and intentional error-correction tasks can trigger them. All 170 units were scanned algorithmically, not all manually proofread.",
              "pages": page_results}
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.annotate:
        for record in ocr:
            warnings = []
            for page_result in page_results:
                if page_result["unitId"] != record["unitId"]:
                    continue
                word_list = record["unitId"] in {"grammar-advanced-038", "grammar-advanced-071", "grammar-advanced-078"}
                warnings.append({"page": page_result["page"], "role": page_result["role"],
                                 "priority": "low" if word_list else page_result["priority"],
                                 "finding": "Rare-word list; plausible false positive, compare source." if word_list else "Possible handwriting-font or crossed-out-text corruption; compare the rendered source before using exact examples.",
                                 "excerpt": page_result["segments"][0]["excerpt"],
                                 "score": page_result["maxScore"]})
            resolved = record["unitId"] == "phrasal-intermediate-008"
            if warnings or resolved:
                record["quality"]["ocrAudit"] = {"version": 1, "scope": "170 units, 340 full pages", "report": str(OUT.relative_to(ROOT)),
                                                   "warnings": warnings, "isProofread": False}
                if resolved:
                    record["quality"]["ocrAudit"]["resolved"] = [{"page": 23, "finding": "Severely garbled handwriting-font letter in exercise 8.1", "resolution": "Entire letter manually transcribed from full-resolution source, preserving six exercise gaps; see phrasal-008-exercise-81-handwritten correction."}]
                path = DATA / (record["unitId"] + ".json")
                temp = path.with_suffix(".json.audit.tmp")
                temp.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
                temp.replace(path)
    print(json.dumps({k: v for k, v in report.items() if k != "pages"}, indent=2))
    print("Priority candidates:")
    for row in page_results[:20]:
        print(row["unitId"], row["page"], row["role"], row["maxScore"], row["segments"][0]["excerpt"][:90])


if __name__ == "__main__":
    main()

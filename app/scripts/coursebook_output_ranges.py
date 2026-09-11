"""Strict whole-answer or explicitly labeled word budgets for reference answers.

Preferred prompt syntax::

    Message: 55–75 слов; Reflection: 15–25 слов

The answer then uses separate line-start ``Message:`` and ``Reflection:``
headers. Labels are case-insensitive ASCII English words, at most 32 letters;
one to four distinct labels are allowed. A definition may quote its label
(``"Message":`` or ``"Message:"``) or parenthesize its range. Headers in the
answer use the plain unquoted form. Every prompt word range must have a label
when any adjacent label definition is detected. Partial contracts fail.

Ordinary prose, including a distant ``Original:`` followed by explanatory text
before a range, retains the legacy first-range whole-answer check. In labeled
mode every non-header character belongs to a block and is counted there; text
before the first block and unknown/duplicate/missing headers fail. Multiline
paragraphs remain part of the preceding block, so trailing prose is never
silently discarded. No source, candidate or supplied regex is modified.
"""
from __future__ import annotations

import re


_RANGE = re.compile(r"(?<!\d)(\d+)\s*[–—-]\s*(\d+)\s+слов\b")
_LABEL_PREFIXES = (
    re.compile(r'(?<![A-Za-z0-9_\-\'"“«])(?P<label>[A-Za-z]{1,32})\s*:\s*(?P<open>\()?\s*$'),
    re.compile(r'''(?P<quote>["'“«])(?P<label>[A-Za-z]{1,32})(?P<close>["'”»])\s*:\s*(?P<open>\()?\s*$'''),
    re.compile(r'''(?P<quote>["'“«])(?P<label>[A-Za-z]{1,32})\s*:(?P<close>["'”»])\s*(?P<open>\()?\s*$'''),
)
_LABEL_HINT = re.compile(r'''\b[A-Za-z0-9_-]+\s*:["'”»]?\s*\(?\s*$''')
_QUOTE_PAIRS = {'"': '"', "'": "'", "“": "”", "«": "»"}
_ANSWER_HEADER = re.compile(r"^[ \t]*(?P<label>[A-Za-z][A-Za-z0-9_-]*)[ \t]*:[ \t]*", re.M)


def _bounds(match):
    values = match.group(1, 2)
    if any(len(value.lstrip("0")) > 4 for value in values):
        raise ValueError("word ranges must satisfy 5 <= minimum <= maximum <= 1000")
    low, high = map(int, values)
    if not 5 <= low <= high <= 1000:
        raise ValueError("word ranges must satisfy 5 <= minimum <= maximum <= 1000")
    return low, high


def _label_before(prompt, match):
    before = prompt[:match.start()]
    for pattern in _LABEL_PREFIXES:
        prefix = pattern.search(before)
        if prefix is None:
            continue
        fields = prefix.groupdict()
        if fields.get("quote") and _QUOTE_PAIRS[fields["quote"]] != fields["close"]:
            raise ValueError("labeled word range has mismatched label quotes")
        if fields.get("open") and not re.match(r"\s*\)", prompt[match.end():]):
            raise ValueError("labeled word range has an unclosed parenthesis")
        return fields["label"]
    if _LABEL_HINT.search(before):
        raise ValueError("labeled word range needs a safe English single-word label and balanced quotes")
    return None


def _contract(prompt):
    ranges = list(_RANGE.finditer(prompt))
    if not ranges:
        raise ValueError("missing explicit N–M слов output range")
    labels = [_label_before(prompt, match) for match in ranges]
    if not any(label is not None for label in labels):
        return None, _bounds(ranges[0])
    if any(label is None for label in labels):
        raise ValueError("partial labeled word-range contract: every range must have an adjacent Label: definition")
    if len(labels) > 4:
        raise ValueError("labeled word-range contract allows at most four labels")
    folded = [label.lower() for label in labels]
    if len(set(folded)) != len(folded):
        raise ValueError("labeled word-range contract defines a label more than once")
    return [(label, *_bounds(match)) for label, match in zip(labels, ranges)], None


def answer_range_findings(prompt, answer, words_regex):
    """Return all answer-block/count failures, or a single invalid-contract issue.

    ``words_regex`` is the caller's compiled word regex, keeping counts identical
    to the existing template. All labeled counts exclude only their headers.
    """
    if not isinstance(prompt, str) or not isinstance(answer, str):
        return ["prompt and reference answer must be strings"]
    if not callable(getattr(words_regex, "findall", None)):
        return ["words_regex must provide findall"]
    try:
        definitions, whole_range = _contract(prompt)
    except ValueError as error:
        return [str(error)]
    if definitions is None:
        low, high = whole_range
        count = len(words_regex.findall(answer))
        return [] if low <= count <= high else [
            f"whole reference answer has {count} words; required {low}–{high}"]

    expected = {label.lower(): (label, low, high) for label, low, high in definitions}
    headers = list(_ANSWER_HEADER.finditer(answer))
    findings, seen = [], set()
    if not headers:
        return ["labeled reference answer needs separate line-start Label: headers"]
    if answer[:headers[0].start()].strip():
        findings.append("labeled reference answer contains unlabelled text before its first block")
    for index, header in enumerate(headers):
        label = header["label"]
        folded = label.lower()
        end = headers[index + 1].start() if index + 1 < len(headers) else len(answer)
        body = answer[header.end():end]
        if folded not in expected:
            findings.append(f"unexpected reference-answer label {label}")
            continue
        canonical, low, high = expected[folded]
        if folded in seen:
            findings.append(f"reference-answer label {canonical} appears more than once")
        seen.add(folded)
        count = len(words_regex.findall(body))
        if not low <= count <= high:
            findings.append(f"reference-answer block {canonical} has {count} words; required {low}–{high}")
    for folded, (label, _, _) in expected.items():
        if folded not in seen:
            findings.append(f"reference-answer label {label} is missing")
    return findings


def validate_answer_ranges(prompt, answer, words_regex):
    """Return None when every applicable count passes; otherwise raise ValueError."""
    findings = answer_range_findings(prompt, answer, words_regex)
    if findings:
        raise ValueError("; ".join(findings))

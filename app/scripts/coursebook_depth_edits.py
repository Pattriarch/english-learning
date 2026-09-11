"""Convert known depth diagnostics to existing, narrowly editable text leaves.

This prepares findings, not a repair or an acceptance. Unknown diagnostics and
noneditable fields fail closed; notably a title deficit requires full repair
because the existing editorial whitelist deliberately excludes lesson.title.
"""
from copy import deepcopy
import re

import coursebook_editorial_patch as editorial
import coursebook_lesson_template as template
from coursebook_output_ranges import answer_range_findings


_INDEX = r"(?:0|[1-9][0-9]*)"
_TOP = re.compile(r"(title|subtitle|goal|formula): (.+)", re.S)
_SECTION = re.compile(rf"sections\[({_INDEX})\]\.body: (.+)", re.S)
_EXAMPLE = re.compile(rf"examples\[({_INDEX})\]\.(en|ru|why): (.+)", re.S)
_EXERCISE = re.compile(rf"exercises\[({_INDEX})\]\(([a-z0-9][a-z0-9-]*)\)(.*)", re.S)
_FIELD = re.compile(r"\.(prompt|context|hint|explanation): (.+)", re.S)
_ANSWER = re.compile(rf"\.answers\[({_INDEX})\]: (.+)", re.S)
_ANSWER_SUFFIX = "; provide a natural complete answer meeting the actual task and all applicable ranges."
_RECORDING = ": explicitly ask to save an AUDIO RECORDING (запишите/сохраните аудиозапись); merely saving a response is ambiguous."
_RECORDING_VERB = re.compile(r"запиш|запис[ьи]|запись|сохран.{0,20}(?:голос|аудио)|record", re.I)


def _fail(message):
    raise ValueError("Depth edits: " + message)


def _leaf(lesson, path):
    if not editorial._allowed(path):
        _fail("diagnostic targets a field outside the editorial whitelist: " + repr(path))
    return editorial._leaf(lesson, path)


def _count_issue(value, detail, minimum, unit="characters"):
    count = len(value.strip()) if unit == "characters" else len(template.WORDS.findall(value))
    if count >= minimum or detail != f"{count} {unit}; requires at least {minimum} substantive {unit}.":
        _fail("unknown or stale depth count diagnostic")


def _path(lesson, diagnostic):
    match = _TOP.fullmatch(diagnostic)
    if match:
        key, detail = match.groups()
        path = [key]
        _count_issue(_leaf(lesson, path), detail, {"title": 5, "subtitle": 25, "goal": 50, "formula": 20}[key])
        return path
    match = _SECTION.fullmatch(diagnostic)
    if match:
        index, detail = match.groups()
        path = ["sections", int(index), "body"]
        value = _leaf(lesson, path)
        if detail.endswith("substantive words."):
            _count_issue(value, detail, 90, "words")
        else:
            _count_issue(value, detail, 500)
        return path
    match = _EXAMPLE.fullmatch(diagnostic)
    if match:
        index, key, detail = match.groups()
        path = ["examples", int(index), key]
        _count_issue(_leaf(lesson, path), detail, {"en": 10, "ru": 8, "why": 90}[key])
        return path
    match = _EXERCISE.fullmatch(diagnostic)
    if match:
        index, identifier, tail = match.groups()
        index = int(index)
        exercises = lesson.get("exercises")
        if (not isinstance(exercises, list) or index >= len(exercises)
                or not isinstance(exercises[index], dict) or exercises[index].get("id") != identifier):
            _fail("exercise diagnostic index/ID differs from the current lesson")
        exercise = exercises[index]
        field = _FIELD.fullmatch(tail)
        if field:
            key, detail = field.groups()
            path = ["exercises", index, key]
            _count_issue(_leaf(lesson, path), detail,
                         {"prompt": 45, "context": 30, "hint": 35, "explanation": 120}[key])
            return path
        answer = _ANSWER.fullmatch(tail)
        if answer:
            answer_index, detail = answer.groups()
            path = ["exercises", index, "answers", int(answer_index)]
            value = _leaf(lesson, path)
            expected = [issue + _ANSWER_SUFFIX for issue in
                        answer_range_findings(exercise.get("prompt"), value, template.WORDS)]
            if detail not in expected:
                _fail("unknown or stale reference-answer diagnostic")
            return path
        if tail == _RECORDING:
            path = ["exercises", index, "prompt"]
            value = _leaf(lesson, path)
            if exercise.get("kind") != "speak" or _RECORDING_VERB.search(value):
                _fail("recording diagnostic differs from current speaking prompt")
            return path
    _fail("unknown depth diagnostic: " + diagnostic)


def depth_edit_findings(lesson):
    """Return deduplicated [{path,issue}], preserving original issue strings.

    Each leaf gets distinct diagnostics joined by newlines in first-seen order.
    Answer diagnostics retain their exact block names and ranges. This function
    never infers source, coverage, material or array edits from a message.
    """
    if not isinstance(lesson, dict):
        _fail("lesson must be an object")
    try:
        diagnostics = template.lesson_depth_findings(deepcopy(lesson))
    except (TypeError, AttributeError, KeyError) as error:
        raise ValueError("Depth edits: malformed lesson cannot supply existing text findings") from error
    if not isinstance(diagnostics, list) or any(not isinstance(d, str) for d in diagnostics):
        _fail("depth diagnostics must be a list of strings")
    grouped = {}
    for diagnostic in diagnostics:
        path = _path(lesson, diagnostic)
        issues = grouped.setdefault(tuple(path), [])
        if diagnostic not in issues:
            issues.append(diagnostic)
    return [{"path": list(path), "issue": "\n".join(issues)} for path, issues in grouped.items()]

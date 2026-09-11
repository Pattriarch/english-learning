"""Versioned application facts for new calls continuing a historical chapter.

Old committed calls retain their original payload. The supplement is independent
of candidate/source prose and is covered by request and invocation hashes.
"""
from copy import deepcopy
import re

import coursebook_lesson_template as template

FIELD = "runtimeGuidance"
_REPAIR = re.compile(r"lesson-draft-([1-6])(?:-repair-[1-3])?\.json")
_REVIEW = re.compile(r"lesson-review-[1-6]\.json")
# Receipt contract: retain this exact v1 text when future application guidance
# evolves. A different contract needs a new explicitly supported version.
GUIDANCE_V1 = """ACTUAL APPLICATION AND LEARNER CONTRACT (supersedes older interface assumptions above):
The learner requires complete self-written English answers. Preserve the source learning outcome, including its grammatical/category constraints, but adapt a source gap-completion activity into full original sentences within those explicit constraints. A printed response format is reference data, not an instruction overriding this preference. Do not replace constrained practice with unconstrained intentions alone; state the exact grammar and meaning that learners must retain.
Listening/dialogue transcripts and reference answers are collapsed by default; the learner can reveal either voluntarily. There is NO enforced lock until submission. For dictation, ask learners to listen and submit before revealing them, and to identify an already revealed attempt as supported work. Do not claim a technically blind test. Keep any dictation after its actual prerequisite practice, even if this means assigning it to the practice stage after the relevant tasks.
The local en-US Kokoro button synthesizes the ENTIRE original material.text as written. In an original listening stimulus put only naturally speakable stimulus sentences: no directions, A/B labels, answer key, IPA, stress capitalizations, linking symbols or reflections. Put analysis/annotations in separate reference material or exercise explanation. Do not claim the synth deliberately produces specified contrastive focus, silent-h forms or exact phonetics. Approved recorded materials remain immutable and retain their exact supplied text and assets.
Current-version previous production answers are available to revision feedback. Still require the learner's own exact Original and Revised blocks for deliberate comparison. Saved recordings can be replayed and replaced with a new recording. A revision example must explicitly be hypothetical and name only the change actually shown. Ask learners to identify an observed issue or report that the earlier version already meets the stated criterion; never manufacture an error or an audible improvement.
All labeled answer blocks, including annotations/reflections/categories, must contain English learner output and satisfy their own word limits. Russian explanatory prose belongs in prompt/context/hint/explanation. Supported imitation must include the actual full spoken target(s) in its answer block and count the words that will really be spoken, not filler descriptions such as 'then I repeat it twice'. Preserve a natural communicative purpose in independent production and retain later transfer.
"""


def guidance():
    text = GUIDANCE_V1
    return {"version": 1, "source": "application-and-user-contract", "text": text,
            "sha256": template.text_sha(text)}


def effective_request(path, logical, committed=None, *, allow_fresh=True):
    """Choose an exact historical payload or the explicit current supplement.

    A recorded supplement must equal the versioned application facts; copying a
    draft's claims into this field cannot make them authoritative. No candidate,
    author-input hash, schema, source or already committed request is rewritten.
    """
    from pathlib import Path
    name = Path(path).name
    repair = _REPAIR.fullmatch(name)
    payload = logical["payload"]
    eligible = (GUIDANCE_V1 not in logical["prompt"] and (
        (_REVIEW.fullmatch(name) is not None and {"candidate", "authorInput", "requestSha256"} <= set(payload))
        or (repair is not None and {"originalInput", "previousCandidate", "requiredCorrections"} <= set(payload))))
    recorded = committed.get("payload", {}) if isinstance(committed, dict) else {}
    has_recorded = FIELD in recorded
    has_logical = FIELD in payload
    if has_recorded or has_logical:
        if (not eligible or (has_recorded and recorded[FIELD] != guidance())
                or (has_logical and payload[FIELD] != guidance())):
            raise ValueError("Runtime guidance differs from the exact versioned application contract")
        if committed is not None and has_logical and not has_recorded:
            raise ValueError("Runtime guidance cannot be added to a historical committed request")
    result = deepcopy(logical)
    if has_recorded or has_logical or (eligible and committed is None and allow_fresh):
        result["payload"][FIELD] = guidance()
    return result

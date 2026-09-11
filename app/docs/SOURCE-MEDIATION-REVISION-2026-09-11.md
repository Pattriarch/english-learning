# Scoped revision: source independence

Review method: agent review of the exact authored diff, supplied evidence, reference answers, Russian rationales, and runtime assessment/version tests. This is not a new review of all 215 authored lessons or the whole CEFR map. The map's original audit date and the other 18 source snapshots are unchanged.

Reviewed file: `app/content/courses/advanced.json`.

- Previous raw-byte SHA256: `fad1f08527e871b4df9f283796facc9cefebd21699ae3bc9f35ee9a113fc7f45`.
- Revised raw-byte SHA256: `d074577ab29c959288d1ad6c5f54fa24717c7c893076cd6cef2fd02f1b02baae`.
- Only changed lesson: `path-source-mediation`.
- Only changed exercises: e4, e5, e6, each with explicit `revision: 1`. The existing content IDs remain stable. Exercises e1–e3 and every other lesson in this file are unchanged.
- Added material: `source-independence-dossier`, attached only to the three revised exercises.

The bounded comparison verifies that all other lesson fields and other lessons are identical to the previous snapshot. The corresponding source snapshot and one outdated evidence note in `c2-mediation-synthesis` were updated; coverage status, evidence references, demonstration criteria, and learner results were not reassigned.

## Content review

The dossier explicitly labels every organization, document, identifier, and result as fictional. It contains three documents derived from two independently collected datasets. Documents A and B both use WB-01; B collected no new data. RV-02 independently records attendance among different learners, but contains no language assessment. Only WB-01 observes a change in a language-test result. The data therefore do not supply three independent studies, an independent replication of the quiz result, or evidence of a causal, lasting change in broader proficiency.

All three complete US English model answers preserve those distinctions. They retain the group mean, the absence of a comparison group and later follow-up, and the difference between attendance and language assessment. They do not interpret missing proof as proof of no effect. Recommendations are identified as the speaker's proposal. The written and spoken adaptations change terminology and detail without changing the provenance or strength of the claim.

e4 requires a provenance reconstruction and correction of the overstated claim; e5 combines a committee memo with a participant-facing adaptation; e6 requires spoken versions for a newcomer and specialist. Their model lengths are 123, 263, and 248 words respectively. The spoken example is explicitly an illustration, not a claimed learner recording or pronunciation assessment.

## Verification

Runtime tests check that every revised assessment receives the complete dossier and current reference answer, and that bare or older practice IDs return HTTP 409. UI tests check current-version drafts, restored feedback, progress, planner targets, mastery references, and publication during a pending check. Historical attempts and unchanged task identities remain available.

The curriculum integrity validator checks current references and raw-byte snapshots; it does not certify pedagogical completeness or an attained CEFR level. Source review is limited to the changes documented above.

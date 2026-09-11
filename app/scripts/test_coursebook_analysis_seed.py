"""Offline tests for unverified analysis reuse; no model or pilot writes."""
from copy import deepcopy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import coursebook_analysis_seed as seeds
import coursebook_lesson_template as contract
import generate_new_coursebooks as pipeline
from test_generate_new_coursebooks import bundle_fixture, write_json


class AnalysisSeedTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundle, self.analysis, _ = bundle_fixture(self.root)
        self.parent = self.root / "unit-source-sets"
        self.folder = self.parent / self.bundle["sourceSetSha256"]
        self.record_path = self.folder / "analysis-seed.json"

    @staticmethod
    def rehash(bundle):
        bundle["sourceSetSha256"] = contract.value_sha({
            key: value for key, value in bundle.items() if key != "sourceSetSha256"})

    def prior(self, name="old-coarse-selector", mutate_bundle=None, mutate_analysis=None, mtime=1000):
        bundle = deepcopy(self.bundle)
        obsolete_manifest = self.root / "obsolete-global-manifest.json"
        obsolete_manifest.write_text('{"otherUnitsChanged":true}', encoding="utf-8")
        bundle["sourceFiles"] = [{"path": str(obsolete_manifest), "sha256": "0" * 64}]
        if mutate_bundle:
            mutate_bundle(bundle)
        self.rehash(bundle)
        analysis = deepcopy(self.analysis)
        analysis["bundleSha256"] = bundle["sourceSetSha256"]
        if mutate_analysis:
            mutate_analysis(analysis)
        folder = self.parent / name
        write_json(folder / "source-bundle.json", bundle)
        write_json(folder / "analysis.json", analysis)
        os.utime(folder / "analysis.json", ns=(mtime, mtime))
        return folder, bundle, analysis

    def load(self, bundle=None):
        return seeds.load_seed(bundle or self.bundle, self.folder, pipeline.validate_analysis)

    def test_seed_changes_only_bundle_hash_and_is_explicitly_unverified(self):
        old_folder, old_bundle, old_analysis = self.prior()
        with patch.object(pipeline, "call_model", side_effect=AssertionError("Seed called a model")), \
                patch.object(pipeline, "verify_ready", side_effect=AssertionError("Seed reused acceptance")), \
                patch.object(pipeline, "validate_bundle", side_effect=AssertionError("Seed reread obsolete selectors")):
            candidate = self.load()
        expected = deepcopy(old_analysis)
        expected["bundleSha256"] = self.bundle["sourceSetSha256"]
        self.assertEqual(candidate, expected)
        self.assertEqual({key: value for key, value in candidate.items() if key != "bundleSha256"},
                         {key: value for key, value in old_analysis.items() if key != "bundleSha256"})
        record = pipeline.read(self.record_path)
        self.assertEqual(record["status"], "unverified-analysis-seed")
        self.assertIs(record["independentReviewRequired"], True)
        self.assertEqual(record["oldSourceSetSha256"], old_bundle["sourceSetSha256"])
        self.assertEqual(record["newSourceSetSha256"], self.bundle["sourceSetSha256"])
        self.assertEqual(record["sourceBundleFile"], str((old_folder / "source-bundle.json").resolve()))
        self.assertEqual(record["sourceBundleFileSha256"], pipeline.file_sha(old_folder / "source-bundle.json"))
        self.assertEqual(record["sourceAnalysisFileSha256"], pipeline.file_sha(old_folder / "analysis.json"))
        self.assertEqual(record["candidateSha256"], contract.value_sha(candidate))
        self.assertEqual(record["recordSha256"], contract.value_sha({
            key: value for key, value in record.items() if key != "recordSha256"}))
        self.assertEqual([path.name for path in self.folder.iterdir()], ["analysis-seed.json"])

    def test_resume_rechecks_immutable_record_and_does_not_mutate_it_or_source(self):
        old_folder, _, old_analysis = self.prior()
        first = self.load()
        original_record = self.record_path.read_bytes()
        first["requiredPoints"][0]["point"] = "A caller changed its returned copy."
        validator = Mock(wraps=pipeline.validate_analysis)
        resumed = seeds.load_seed(self.bundle, self.folder, validator)
        validator.assert_called_once()
        self.assertEqual(resumed["requiredPoints"], old_analysis["requiredPoints"])
        self.assertEqual(self.record_path.read_bytes(), original_record)
        self.assertEqual(pipeline.read(old_folder / "analysis.json"), old_analysis)

    def test_newest_compatible_complete_analysis_wins_over_newer_incompatible_or_invalid_sources(self):
        _, _, oldest = self.prior("oldest", mtime=1000)
        _, _, newest = self.prior("newest-compatible", mtime=2000,
            mutate_analysis=lambda value: value["pageCoverage"][0].update(observations=
                "A newer specific observation preserves the same complete source and all meaningful visual details."))
        self.prior("newer-incompatible", mtime=3000,
                   mutate_bundle=lambda value: value["chapter"].update(title="Different teaching scope"))
        self.prior("newest-invalid-analysis", mtime=4000,
                   mutate_analysis=lambda value: value.update(pageCoverage=[]))
        candidate = self.load()
        self.assertEqual(candidate["pageCoverage"], newest["pageCoverage"])
        self.assertNotEqual(candidate["pageCoverage"], oldest["pageCoverage"])
        self.assertIn("newest-compatible", pipeline.read(self.record_path)["sourceAnalysisFile"])

    def test_only_top_level_source_file_bookkeeping_is_ignored(self):
        changes = {
            "chapter": lambda value: value["chapter"].update(title="Different title"),
            "source": lambda value: value["source"].update(text=value["source"]["text"] + " Changed full text."),
            "heading": lambda value: value["headingCandidates"][0].update(headings=["Different heading"]),
            "audio-material": lambda value: value.update(approvedMaterials=[{"text": "Different transcript"}]),
            "audio-tracks": lambda value: value.update(declaredAudioTracks=[1]),
            "attachment": lambda value: value["attachments"][0].update(sha256="f" * 64),
            "nested-bookkeeping": lambda value: value["source"].update(sourceFiles=["Do not strip nested data"]),
        }
        for name, change in changes.items():
            self.prior(name, mutate_bundle=change)
            with self.subTest(field=name):
                self.assertIsNone(self.load())
                self.assertFalse(self.record_path.exists())

    def test_no_compatible_seed_is_not_negatively_cached(self):
        self.assertIsNone(self.load())
        self.assertFalse(self.record_path.exists())
        self.prior()
        self.assertIsNotNone(self.load())
        self.assertTrue(self.record_path.exists())

    def test_existing_draft_request_prevents_seed_creation_and_resume(self):
        self.prior()
        self.folder.mkdir(parents=True)
        write_json(self.folder / "analysis-draft-1.request.json", {"existing": "model request"})
        validator = Mock(side_effect=AssertionError("Existing model checkpoint was seeded"))
        self.assertIsNone(seeds.load_seed(self.bundle, self.folder, validator))
        self.assertFalse(self.record_path.exists())
        validator.assert_not_called()

    def test_both_bundle_self_hashes_are_required_without_reading_obsolete_file_checksums(self):
        folder, _, _ = self.prior()
        old_bundle = pipeline.read(folder / "source-bundle.json")
        old_bundle["sourceSetSha256"] = "a" * 64
        write_json(folder / "source-bundle.json", old_bundle)
        self.assertIsNone(self.load())
        self.assertFalse(self.record_path.exists())
        changed = deepcopy(self.bundle)
        changed["sourceSetSha256"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "self-hash"):
            self.load(changed)

    def test_old_candidate_must_be_complete_and_bound_to_its_prior_bundle(self):
        changes = [lambda value: value.update(bundleSha256="a" * 64),
                   lambda value: value.update(unresolved=["Cannot interpret an essential source table."]),
                   lambda value: value.update(requiredPoints=[])]
        for index, change in enumerate(changes):
            self.prior(f"invalid-{index}", mutate_analysis=change)
            with self.subTest(index=index):
                self.assertIsNone(self.load())
        self.assertFalse(self.record_path.exists())

    def test_resume_rejects_even_format_only_changes_to_old_exact_files(self):
        folder, _, _ = self.prior()
        self.load()
        original_record = self.record_path.read_bytes()
        for name in ("source-bundle.json", "analysis.json"):
            path = folder / name
            raw = path.read_bytes()
            path.write_bytes(raw + b"\n")
            with self.subTest(file=name), self.assertRaisesRegex(ValueError, "artifact bytes changed"):
                self.load()
            self.assertEqual(self.record_path.read_bytes(), original_record)
            path.write_bytes(raw)

    def test_resume_rejects_altered_candidate_even_when_record_hashes_are_recomputed(self):
        self.prior()
        self.load()
        record = pipeline.read(self.record_path)
        record["candidate"]["requiredPoints"][0]["point"] += " Altered after selecting this seed."
        record["candidateSha256"] = contract.value_sha(record["candidate"])
        record["recordSha256"] = contract.value_sha({key: value for key, value in record.items() if key != "recordSha256"})
        write_json(self.record_path, record)
        with self.assertRaisesRegex(ValueError, "exact rebased"):
            self.load()

    def test_resume_rejects_a_different_current_semantic_bundle(self):
        self.prior()
        self.load()
        changed = deepcopy(self.bundle)
        changed["chapter"]["title"] = "A different current chapter scope"
        self.rehash(changed)
        with self.assertRaisesRegex(ValueError, "different current source"):
            self.load(changed)


if __name__ == "__main__":
    unittest.main()

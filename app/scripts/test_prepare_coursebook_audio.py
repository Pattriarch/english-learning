"""Source/transcript integrity tests; no speech server or model calls."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import prepare_coursebook_audio as audio


class CoursebookAudioTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.sources = self.root / "app/data/new-coursebooks"
        self.output = self.sources / "audio"
        for name, value in (("ROOT", self.root), ("SOURCES", self.sources), ("OUT", self.output)):
            patcher = patch.object(audio, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.recording = {"id": "clear-speech-3-track-001.mp3", "unitId": "clear-speech-3-001", "track": 1,
                          "task": "A", "filename": "more/Audio/01.mp3", "bytes": 6, "sha256": audio.sha(b"source")}
        path = self.root / "книги" / self.recording["filename"]
        path.parent.mkdir(parents=True)
        path.write_bytes(b"source")
        self.pack = {"unitId": "clear-speech-3-001", "title": "Syllables", "pages": [22, 23, 24],
                     "pageTexts": [{"page": p, "text": f"Source page {p}"} for p in [22, 23, 24]],
                     "provenance": {"sourceHash": "a" * 64, "sourceImages": []}}
        for page in self.pack["pages"]:
            image_path = self.sources / f"images/{page}.jpg"
            image_path.parent.mkdir(parents=True, exist_ok=True)
            image_path.write_bytes(f"page image {page}".encode())
            self.pack["provenance"]["sourceImages"].append({"page": page, "path": f"images/{page}.jpg", "sha256": audio.sha(image_path.read_bytes())})
        audio.atomic_json(self.sources / "units/clear-speech-3-001.json", self.pack)
        text = "Unit one, A. Listen: ease, easy, easily."
        self.asr = {"track": 1, "unitId": self.pack["unitId"], "task": "A", "text": text,
                    "audioSha256": self.recording["sha256"], "textSha256": audio.sha(text.encode())}
        audio.atomic_json(self.output / "asr/001.json", self.asr)
        self.review = {"unitId": self.pack["unitId"], "pageObservations": [{"page": p, "observation": "This page contains the chapter's specific teaching examples."} for p in self.pack["pages"]],
                       "tracks": [{"track": 1, "task": "A", "title": "Introducing syllables", "text": text, "pages": [22],
                                   "status": "source-checked", "alignmentEvidence": "The recording's ease, easy and easily sequence corresponds to the three-column syllable examples in task A on PDF page 22.",
                                   "corrections": [], "uncertainties": [], "limitations": ["No independent acoustic review."]}]}

    def save_review(self):
        _, _, digest = audio.review_input(self.pack, [self.recording])
        review = {**self.review, "inputHash": digest, "reviewVersion": audio.REVIEW_VERSION, "method": "Source images and ASR; no acoustic review"}
        audio.atomic_json(self.output / "reviews/clear-speech-3-001.json", review)

    def test_recording_source_pins_hash_and_confines_paths(self):
        path, raw = audio.recording_source(self.recording)
        self.assertEqual(raw, b"source")
        for filename in ["../outside.mp3", "more/../outside.mp3", "C:/outside.mp3", "more\\01.mp3"]:
            with self.assertRaises(ValueError):
                audio.recording_source({**self.recording, "filename": filename})
        path.write_bytes(b"tamper")
        with self.assertRaises(ValueError):
            audio.recording_source(self.recording)

    def test_review_input_rejects_missing_middle_image_and_changed_asr(self):
        payload, images, digest = audio.review_input(self.pack, [self.recording])
        self.assertEqual(len(images), 3)
        self.assertEqual(len(digest), 64)
        damaged = copy.deepcopy(self.pack)
        damaged["provenance"]["sourceImages"].pop(1)
        with self.assertRaises(ValueError):
            audio.review_input(damaged, [self.recording])
        changed = {**self.asr, "text": "Different speech"}
        audio.atomic_json(self.output / "asr/001.json", changed)
        with self.assertRaises(ValueError):
            audio.review_input(self.pack, [self.recording])

    def test_review_must_inspect_every_page_and_match_track_inventory(self):
        audio.validate_review(self.review, self.pack, [self.recording])
        changes = [lambda r: r["pageObservations"].pop(1), lambda r: r["tracks"].clear(),
                   lambda r: r["tracks"][0].update({"task": "B"}), lambda r: r["tracks"][0].update({"pages": [21]}),
                   lambda r: r["tracks"][0].update({"alignmentEvidence": "Looks fine"})]
        for mutate in changes:
            review = copy.deepcopy(self.review)
            mutate(review)
            with self.assertRaises(ValueError):
                audio.validate_review(review, self.pack, [self.recording])

    def test_uncertain_transcripts_cannot_be_approved(self):
        self.review["tracks"][0]["uncertainties"] = ["ASR cannot identify one example"]
        with self.assertRaises(ValueError):
            audio.validate_review(self.review, self.pack, [self.recording])
        self.review["tracks"][0]["status"] = "needs-review"
        self.save_review()
        summary = audio.assemble([self.recording])
        self.assertEqual(summary, {"preparedUnits": 0, "preparedTracks": 0, "pendingUnits": 1})
        result = json.loads((self.output / "materials.json").read_text(encoding="utf-8"))
        self.assertEqual(result["pending"][0]["tracks"], [1])

    def test_contradictory_model_approval_is_conservatively_held(self):
        self.review["tracks"][0]["uncertainties"] = ["One source contrast remains unresolved"]
        held = audio.hold_uncertain_tracks(self.review)
        self.assertEqual(held["tracks"][0]["status"], "needs-review")
        audio.validate_review(held, self.pack, [self.recording])

    def test_secondary_recognition_is_identity_bound_and_invalidates_old_review(self):
        self.save_review()
        secondary = {**self.asr, "modelSha256": audio.SECONDARY_MODEL_SHA, "asr": "second local decoder"}
        audio.atomic_json(self.output / "secondary-asr/001.json", secondary)
        self.assertEqual(audio.assemble([self.recording])["preparedTracks"], 0)
        secondary["audioSha256"] = "0" * 64
        audio.atomic_json(self.output / "secondary-asr/001.json", secondary)
        with self.assertRaises(ValueError):
            audio.review_input(self.pack, [self.recording])

    def test_constrained_recognition_is_private_hashed_evidence_not_a_fixed_answer(self):
        self.save_review()
        evidence = {"track": 1, "pages": [22], "audioSha256": self.recording["sha256"], "modelSha256": audio.SECONDARY_MODEL_SHA,
                    "method": "All printed row alternatives allowed", "segments": [{"item": 1, "offsetMs": 9500, "durationMs": 4500,
                    "allPrintedAlternatives": ["Paid", "Pad", "Pawed"], "text": "1. Pawed.", "rawResponse": {"private": "recognition timings"}}]}
        audio.atomic_json(self.output / "constrained-asr/001.json", evidence)
        payload, _, _ = audio.review_input(self.pack, [self.recording])
        item = payload["tracks"][0]["constrainedRecognition"]
        self.assertEqual(item["segments"][0]["allPrintedAlternatives"], ["Paid", "Pad", "Pawed"])
        self.assertNotIn("rawResponse", item["segments"][0])
        self.assertEqual(len(item["evidenceSha256"]), 64)
        self.assertEqual(audio.assemble([self.recording])["preparedTracks"], 0)
        evidence["pages"] = [99]
        audio.atomic_json(self.output / "constrained-asr/001.json", evidence)
        with self.assertRaises(ValueError):
            audio.review_input(self.pack, [self.recording])

    def test_phoneme_evidence_is_pinned_to_original_audio_and_core_pages(self):
        evidence = {"track": 1, "pages": [22], "audioSha256": self.recording["sha256"], "modelSha256": audio.PHONEME_MODEL_SHA,
                    "method": "Unconstrained phoneme labels, not assessment", "segments": [{"label": "word", "phonemes": "t iː ð", "ctcIDs": [1, 2, 3]}]}
        audio.atomic_json(self.output / "phoneme-asr/001.json", evidence)
        payload, _, _ = audio.review_input(self.pack, [self.recording])
        item = payload["tracks"][0]["phonemeRecognition"]
        self.assertEqual(item["segments"][0]["phonemes"], "t iː ð")
        self.assertNotIn("ctcIDs", item["segments"][0])
        evidence["audioSha256"] = "0" * 64
        audio.atomic_json(self.output / "phoneme-asr/001.json", evidence)
        with self.assertRaises(ValueError):
            audio.review_input(self.pack, [self.recording])

    @unittest.skipUnless(importlib.util.find_spec("soundfile"), "Optional exact audio crop dependency is not installed")
    def test_exact_audio_crop_has_only_requested_samples_and_preserves_source(self):
        import numpy as np
        import soundfile as sf
        source, target = self.root / "wave.wav", self.root / "crop.wav"
        values = np.arange(16000, dtype=np.int16)
        sf.write(source, values, 16000, subtype="PCM_16")
        original = source.read_bytes()
        identity = audio.write_audio_crop(source, target, 250, 500)
        cropped, rate = sf.read(target, dtype="int16")
        self.assertEqual(rate, 16000)
        self.assertEqual(identity["samples"], 8000)
        self.assertTrue(np.array_equal(cropped, values[4000:12000]))
        self.assertEqual(source.read_bytes(), original)
        with self.assertRaises(ValueError):
            audio.write_audio_crop(source, target, 800, 500)

    def test_assembled_material_pins_transcript_audio_and_original_source_pages(self):
        self.save_review()
        self.assertEqual(audio.assemble([self.recording])["preparedTracks"], 1)
        result = audio.read_json(self.output / "materials.json")
        material = result["units"][self.pack["unitId"]][0]
        self.assertEqual(material["audioFile"], "/book-recordings/clear-speech-3-track-001.mp3")
        self.assertEqual(material["audioSha256"], audio.sha(Path(material["audioPath"]).read_bytes()))
        self.assertEqual(material["transcriptSha256"], audio.sha(material["text"].encode()))
        self.assertEqual(material["pages"], [22])
        self.assertIn("no acoustic review", material["reviewMethod"])

    def test_stale_review_cannot_publish_after_source_text_changes(self):
        self.save_review()
        self.asr["text"] += " Additional sentence."
        self.asr["textSha256"] = audio.sha(self.asr["text"].encode())
        audio.atomic_json(self.output / "asr/001.json", self.asr)
        self.assertEqual(audio.assemble([self.recording])["preparedTracks"], 0)


@unittest.skipUnless((audio.OUT / "materials.json").exists(), "Private source transcripts are not distributed")
class PreparedCoursebookAudioIntegrityTests(unittest.TestCase):
    def test_all_82_source_aligned_materials_match_every_declared_track(self):
        registry = audio.read_json(audio.APP / "content/book-recordings.json")["recordings"]
        materials = audio.read_json(audio.OUT / "materials.json")
        self.assertEqual(materials["pending"], [])
        self.assertEqual(len(materials["units"]), 15)
        self.assertEqual(sum(map(len, materials["units"].values())), 82)
        for uid, items in materials["units"].items():
            group = [r for r in registry if r["unitId"] == uid]
            pack = audio.read_json(audio.SOURCES / "units" / f"{uid}.json")
            review = audio.read_json(audio.OUT / "reviews" / f"{uid}.json")
            audio.validate_review(review, pack, group)
            self.assertEqual(review["inputHash"], audio.review_input(pack, group)[2])
            self.assertEqual([item["track"] for item in items], pack["audioTracks"])
            for item, recording, track in zip(items, group, review["tracks"]):
                self.assertEqual(item["text"], track["text"])
                self.assertEqual(item["transcriptSha256"], audio.sha(item["text"].encode("utf-8")))
                self.assertEqual(item["audioSha256"], audio.sha(Path(item["audioPath"]).read_bytes()))
                self.assertEqual(item["audioFile"], "/book-recordings/" + recording["id"])
                self.assertEqual(track["status"], "source-checked")
                self.assertFalse(track["uncertainties"])
                self.assertTrue(set(item["pages"]) <= set(pack["pages"]))


if __name__ == "__main__":
    unittest.main()

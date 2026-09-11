"""Public inventory and optional private-source integrity checks; no model calls."""
import hashlib
import json
from pathlib import Path
import unittest

from intake_new_coursebooks import APP, OUT, ROOT, section_candidates
from prepare_coursebook_manifest import physical_page, validate_book


class NewCoursebookManifestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest=json.loads((APP/"content/new-coursebooks-intake.json").read_text(encoding="utf-8"))

    def test_all_student_pages_have_one_owner_and_chapter_counts_match_tocs(self):
        self.assertEqual([b["unitCount"] for b in self.manifest["books"]],[15,8,11,7,6,12])
        self.assertEqual(sum(b["pdfPageCount"] for b in self.manifest["books"]),1463)
        ids=[]
        for book in self.manifest["books"]:
            validate_book(book)
            ids.extend(u["id"] for u in book["units"])
        self.assertEqual(len(ids),59)
        self.assertEqual(len(set(ids)),59)

    def test_missing_printed_gw3_page_is_never_synthesized(self):
        self.assertEqual(physical_page("great-writing-3-3",229),244)
        self.assertEqual(physical_page("great-writing-3-3",231),245)
        with self.assertRaises(ValueError): physical_page("great-writing-3-3",230)

    def test_audio_table_maps_selected_exercises_without_inventing_media(self):
        audio=self.manifest["audio"][0]
        tracks=audio["tracks"]
        self.assertEqual([t["track"] for t in tracks],list(range(1,83)))
        self.assertEqual([(t["unitId"],t["task"]) for t in tracks[:2]],[("clear-speech-3-001","A"),("clear-speech-3-001","C")])
        self.assertEqual((tracks[-1]["unitId"],tracks[-1]["task"]),("clear-speech-3-015","K"))
        self.assertFalse(any(t["unitId"]=="clear-speech-3-001" and t["task"]=="B" for t in tracks))
        self.assertEqual([x["coursebookId"] for x in self.manifest["audio"]],["clear-speech-3"])
        self.assertEqual(self.manifest["missingCourses"][0]["available"],"Workbook only")

    def test_served_audio_registry_preserves_every_source_mapping(self):
        registry=json.loads((APP/"content/book-recordings.json").read_text(encoding="utf-8"))
        self.assertEqual(registry["version"],1)
        self.assertEqual(len(registry["recordings"]),82)
        for served,source in zip(registry["recordings"],self.manifest["audio"][0]["tracks"]):
            self.assertEqual(served["id"],f"clear-speech-3-track-{source['track']:03d}.mp3")
            for key in ["unitId","task","track","filename","sha256","durationSeconds"]:
                self.assertEqual(served[key],source[key])
            self.assertEqual(served["bookId"],"clear-speech-3")

    def test_all_companion_references_resolve_and_stay_in_their_pdf(self):
        companions={c["id"]:c for c in self.manifest["companions"]}
        self.assertEqual(len(companions),9)
        for book in self.manifest["books"]:
            for unit in book["units"]:
                for ref in unit["companionUnits"]:
                    self.assertIn(ref["companionId"],companions)
                    self.assertTrue(all(1<=p<=companions[ref["companionId"]]["pdfPageCount"] for p in ref["pages"]))

    def test_semantic_candidates_reject_body_questions_and_do_not_split_by_page_count(self):
        unit={"page":10,"endPage":50,"title":"Exploring the Essay"}
        pages=[{"page":10,"text":"What is the title of this textbook? Look on the front cover."},
               {"page":25,"text":"Writing the Introduction\nThe introduction is the first part of an essay."},
               {"page":40,"text":"Original Student Writing"}]
        result=section_candidates(unit,pages,"writing")
        self.assertEqual([(r["page"],r["endPage"]) for r in result],[(10,24),(25,39),(40,50)])
        self.assertEqual(result[1]["headings"],["Writing the Introduction"])


@unittest.skipUnless((OUT/"source-index.json").exists(),"Private user-supplied book sources are not distributed in Git")
class NewCoursebookPrivateIntegrityTests(unittest.TestCase):
    def test_registered_audio_bytes_match_verified_local_sources(self):
        registry=json.loads((APP/"content/book-recordings.json").read_text(encoding="utf-8"))
        total=0
        for recording in registry["recordings"]:
            raw=(ROOT/"книги"/recording["filename"]).read_bytes()
            self.assertEqual(len(raw),recording["bytes"])
            self.assertEqual(hashlib.sha256(raw).hexdigest(),recording["sha256"])
            total+=len(raw)
        self.assertEqual(total,68287551)

    def test_every_extracted_page_and_image_matches_its_prepared_unit(self):
        index=json.loads((OUT/"source-index.json").read_text(encoding="utf-8"))
        self.assertEqual(index["majorUnits"],59)
        self.assertEqual(index["supplements"],34)
        checked_images=set()
        for summary in index["units"]:
            record=json.loads((OUT/summary["sourceFile"]).read_text(encoding="utf-8"))
            self.assertEqual([p["page"] for p in record["pageTexts"]],record["pages"])
            self.assertEqual([p["page"] for p in record["provenance"]["sourceImages"]],record["pages"])
            self.assertEqual(record["text"],"\n\n".join(p["text"] for p in record["pageTexts"]))
            self.assertEqual(hashlib.sha256(record["text"].encode()).hexdigest(),record["provenance"]["sourceHash"])
            for image in record["provenance"]["sourceImages"]:
                if image["path"] in checked_images:continue
                raw=(OUT/image["path"]).read_bytes()
                self.assertTrue(raw.startswith(b"\xff\xd8") and raw.endswith(b"\xff\xd9"))
                self.assertEqual(hashlib.sha256(raw).hexdigest(),image["sha256"])
                checked_images.add(image["path"])

    def test_complete_student_and_companion_physical_page_inventories(self):
        manifest=json.loads((APP/"content/new-coursebooks-intake.json").read_text(encoding="utf-8"))
        total=0
        for book in manifest["books"]+manifest["companions"]:
            record=json.loads((OUT/book["id"]/"pages.json").read_text(encoding="utf-8"))
            self.assertEqual(record["sha256"],book["sha256"])
            self.assertEqual([p["page"] for p in record["pages"]],list(range(1,book["pdfPageCount"]+1)))
            self.assertFalse(any(p["error"] for p in record["pages"]))
            total+=len(record["pages"])
        self.assertEqual(total,2224)


if __name__=="__main__":unittest.main()

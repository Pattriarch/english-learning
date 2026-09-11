"""Regression tests for long chapters and safe user-supplied PDF locations."""
import tempfile
from pathlib import Path
import unittest

from book_source_contract import pdf_source_path, source_pages, unit_pages, valid_pdf_name
import build_book_lessons as build


class BookSourceContractTests(unittest.TestCase):
    def test_page_inventories_preserve_two_page_units_and_single_pages(self):
        self.assertEqual(unit_pages({"page": 10, "endPage": 11}), [10, 11])
        self.assertEqual(unit_pages({"page": 10, "endPage": 10}), [10])
        self.assertEqual(unit_pages({"page": 10, "endPage": 14}), [10, 11, 12, 13, 14])
        with self.assertRaises(ValueError):
            unit_pages({"page": 10, "endPage": 14, "pages": [10, 14]})

    def test_source_and_extracted_page_inventories_must_match(self):
        for pages in ([10, 14], [10, 11, 11], [11, 10], [], [True, 2]):
            with self.subTest(pages=pages), self.assertRaises(ValueError):
                source_pages({"pages": pages})
        with self.assertRaises(ValueError):
            source_pages({"pages": [10, 11, 12], "pageTexts": [{"page": 10}, {"page": 12}]})
        with self.assertRaises(ValueError):
            source_pages({"pages": [10, 11]}, [10, 11, 12])
        pages = [10, 11, 12]
        self.assertEqual(source_pages({"pages": pages, "pageTexts": [{"page": p} for p in pages]}), pages)

    def test_middle_page_image_is_required_before_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / "book"
            folder.mkdir()
            source = {"bookId": "book", "pages": [10, 11, 12]}
            for page in (10, 12):
                (folder / f"{page}.jpg").write_bytes(b"\xff\xd8image\xff\xd9")
            self.assertIsNone(build.image_records(source, directory))
            (folder / "11.jpg").write_bytes(b"\xff\xd8middle\xff\xd9")
            self.assertEqual([p["page"] for p in build.image_records(source, directory)], [10, 11, 12])
            source["pages"] = [10, 12]
            with self.assertRaises(ValueError):
                build.image_records(source, directory)

    def test_relative_pdf_paths_reject_windows_aliases_and_traversal(self):
        for name in ("Book.pdf", "more/Clear Speech.pdf", "more/ещё/Книга.PDF"):
            self.assertTrue(valid_pdf_name(name), name)
        for name in ("/book.pdf", "../book.pdf", "more/../book.pdf", "more//book.pdf", "more/./book.pdf",
                     "C:/book.pdf", "more\\book.pdf", "book.pdf:stream", "more/CON.pdf", "more/LPT1.pdf",
                     "more/COM¹.pdf", "more. /book.pdf", "more/book.pdf ", "more/book.txt", "more/x\x00.pdf"):
            self.assertFalse(valid_pdf_name(name), name)

    def test_resolved_pdf_stays_inside_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "books"
            (root / "more").mkdir(parents=True)
            pdf = root / "more/Book.pdf"
            pdf.write_bytes(b"%PDF synthetic")
            self.assertEqual(pdf_source_path(root, "more/Book.pdf"), pdf.resolve())
            outside = Path(directory) / "outside.pdf"
            outside.write_bytes(b"private")
            try:
                (root / "link.pdf").symlink_to(outside)
            except OSError:
                self.skipTest("Symlinks require Windows privileges")
            with self.assertRaises(ValueError):
                pdf_source_path(root, "link.pdf")


if __name__ == "__main__":
    unittest.main()

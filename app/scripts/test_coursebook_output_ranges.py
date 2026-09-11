"""Offline output-budget regressions, including ambiguous and adversarial blocks."""
import re
import unittest

from coursebook_output_ranges import answer_range_findings, validate_answer_ranges


WORDS = re.compile(r"[\w]+(?:['’][\w]+)*", re.UNICODE)
MESSAGE = "I sent the package this morning."  # Six words.
REFLECTION = "I chose a very clear and polite request."  # Eight words.


class AnswerRangeTests(unittest.TestCase):
    def test_separate_recipient_message_and_reflection_keep_individual_budgets(self):
        prompt = "Напишите адресату. Message: 6–7 слов; Reflection: 8–9 слов."
        answer = f"Message: {MESSAGE}\nReflection: {REFLECTION}"
        self.assertIsNone(validate_answer_ranges(prompt, answer, WORDS))
        self.assertEqual(answer_range_findings(prompt, answer, WORDS), [])
        self.assertGreater(len(WORDS.findall(answer)), 7)

    def test_quotes_parentheses_dashes_case_and_block_order_are_unambiguous(self):
        definitions = (
            '"Message": (6-7 слов); “Reflection:” (8—9 слов)',
            "'Message:' 6–7 слов; «Reflection»: 8–9 слов",
            "Message: 6–7 слов; Reflection: (8–9 слов)",
        )
        answer = f"reflection: {REFLECTION}\r\n\r\n  MESSAGE: {MESSAGE}\n"
        for prompt in definitions:
            with self.subTest(prompt=prompt):
                self.assertIsNone(validate_answer_ranges(prompt, answer, WORDS))

    def test_four_revision_components_are_counted_without_header_words(self):
        labels = ("Original", "Revised", "Changes", "Adjustment")
        prompt = "; ".join(f"{label}: 6–7 слов" for label in labels)
        answer = "\n".join(f"{label}: {MESSAGE}" for label in labels)
        self.assertIsNone(validate_answer_ranges(prompt, answer, WORDS))

    def test_generic_single_word_label_and_multiline_body_use_supplied_regex(self):
        prompt = "Recipient: 5–5 слов; Rationale: 5–5 слов"
        answer = "Recipient: We can't\naccept this offer.\nRationale: This isn't what we requested."
        self.assertIsNone(validate_answer_ranges(prompt, answer, WORDS))
        splitting_contractions = re.compile(r"\w+")
        self.assertEqual(len(answer_range_findings(prompt, answer, splitting_contractions)), 2)

    def test_ordinary_legacy_prompt_counts_entire_answer_against_first_range(self):
        prompt = "Напишите 6–7 слов. В другом упражнении будет 20–30 слов."
        self.assertIsNone(validate_answer_ranges(prompt, MESSAGE, WORDS))
        with self.assertRaisesRegex(ValueError, "whole reference answer"):
            validate_answer_ranges(prompt, f"Message: {MESSAGE}\nReflection: {REFLECTION}", WORDS)

    def test_distant_original_and_revised_labels_do_not_create_a_partial_parser(self):
        prompt = ('Представьте Original: исходный фрагмент 6–7 слов, затем '
                  'Revised: его исправленный вариант 6–7 слов.')
        answer = f"Original: {MESSAGE}\nRevised: {MESSAGE}"
        with self.assertRaisesRegex(ValueError, "whole reference answer"):
            validate_answer_ranges(prompt, answer, WORDS)

    def test_partial_contract_never_silently_excludes_unlabelled_scope(self):
        prompts = (
            "Message: 6–7 слов; затем поясните выбор в 8–9 слов.",
            "Всего 6–7 слов. Reflection: 8–9 слов.",
        )
        for prompt in prompts:
            with self.subTest(prompt=prompt), self.assertRaisesRegex(ValueError, "partial labeled"):
                validate_answer_ranges(prompt, MESSAGE, WORDS)

    def test_missing_duplicate_and_unknown_answer_blocks_all_fail(self):
        prompt = "Message: 6–7 слов; Reflection: 8–9 слов"
        cases = {
            "missing": (f"Message: {MESSAGE}", "Reflection is missing"),
            "duplicate": (f"Message: {MESSAGE}\nmessage: {MESSAGE}\nReflection: {REFLECTION}", "more than once"),
            "unknown": (f"Message: {MESSAGE}\nReflection: {REFLECTION}\nExtra: {MESSAGE}", "unexpected"),
            "inline": (f"Message: {MESSAGE} Reflection: {REFLECTION}", "Reflection is missing"),
            "no-headers": (f"{MESSAGE}\n{REFLECTION}", "line-start"),
        }
        for label, (answer, expected) in cases.items():
            with self.subTest(case=label), self.assertRaisesRegex(ValueError, expected):
                validate_answer_ranges(prompt, answer, WORDS)

    def test_prefix_and_trailing_text_cannot_escape_counting(self):
        prompt = "Message: 6–7 слов; Reflection: 8–9 слов"
        valid = f"Message: {MESSAGE}\nReflection: {REFLECTION}"
        with self.assertRaisesRegex(ValueError, "unlabelled text before"):
            validate_answer_ranges(prompt, "Unlabelled introduction.\n" + valid, WORDS)
        with self.assertRaisesRegex(ValueError, "Reflection has"):
            validate_answer_ranges(prompt, valid + "\nAn extra unlabelled sentence goes here.", WORDS)
        with self.assertRaisesRegex(ValueError, "unlabelled text before"):
            validate_answer_ranges(prompt, "```text\n" + valid + "\n```", WORDS)

    def test_all_out_of_range_components_are_reported_and_cannot_offset_each_other(self):
        prompt = "Message: 6–7 слов; Reflection: 8–9 слов"
        answer = "Message: Too short.\nReflection: I chose a very clear and polite request for this particular reader."
        findings = answer_range_findings(prompt, answer, WORDS)
        self.assertEqual(len(findings), 2)
        self.assertIn("Message has 2 words", findings[0])
        self.assertIn("Reflection has 12 words", findings[1])
        with self.assertRaisesRegex(ValueError, "Message.*Reflection"):
            validate_answer_ranges(prompt, answer, WORDS)

    def test_empty_block_is_not_filled_from_another_block(self):
        prompt = "Message: 6–7 слов; Reflection: 8–9 слов"
        with self.assertRaisesRegex(ValueError, "Message has 0 words"):
            validate_answer_ranges(prompt, f"Message:\nReflection: {REFLECTION}", WORDS)

    def test_duplicate_definitions_and_more_than_four_labels_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "defines a label more than once"):
            validate_answer_ranges("Message: 6–7 слов; message: 6–7 слов", MESSAGE, WORDS)
        prompt = "; ".join(f"{label}: 6–7 слов" for label in ("One", "Two", "Three", "Four", "Five"))
        with self.assertRaisesRegex(ValueError, "at most four"):
            validate_answer_ranges(prompt, MESSAGE, WORDS)

    def test_every_defined_range_must_meet_bounds(self):
        for invalid in ("4–8", "8–5", "5–1001", "999999999999999999999999999–1000"):
            for prompt in (f"Напишите {invalid} слов", f"Message: 6–7 слов; Reflection: {invalid} слов"):
                with self.subTest(prompt=prompt), self.assertRaisesRegex(ValueError, "5 <= minimum"):
                    validate_answer_ranges(prompt, MESSAGE, WORDS)

    def test_boundary_ranges_five_and_one_thousand_are_allowed(self):
        self.assertIsNone(validate_answer_ranges("Напишите 5–5 слов", "We cannot accept this offer.", WORDS))
        self.assertIsNone(validate_answer_ranges("Message: 1000–1000 слов", "Message: " + "word " * 1000, WORDS))

    def test_malformed_quotes_parentheses_and_unsafe_labels_fail(self):
        prompts = (
            '"Message”: 6–7 слов',
            '"Message: 6–7 слов',
            "Message: (6–7 слов",
            "Message_1: 6–7 слов",
            "Message2: 6–7 слов",
            "Message-Reply: 6–7 слов",
            "2Message: 6–7 слов",
        )
        for prompt in prompts:
            with self.subTest(prompt=prompt), self.assertRaises(ValueError):
                validate_answer_ranges(prompt, MESSAGE, WORDS)

    def test_missing_range_and_invalid_inputs_are_findings_not_silent_acceptance(self):
        cases = (("Напишите ответ.", MESSAGE, WORDS), (None, MESSAGE, WORDS),
                 ("Напишите 6–7 слов", None, WORDS), ("Напишите 6–7 слов", MESSAGE, None))
        for arguments in cases:
            with self.subTest(arguments=arguments):
                self.assertTrue(answer_range_findings(*arguments))
                with self.assertRaises(ValueError):
                    validate_answer_ranges(*arguments)


if __name__ == "__main__":
    unittest.main()

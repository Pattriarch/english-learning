package studio

import "testing"

func TestAmericanSpeechTextReadsNumbersAsTaught(t *testing.T) {
	for input, want := range map[string]string{
		"My number is (312) 555-0147.":        "My number is three one two, five five five, oh one four seven.",
		"Call 718-555-0136 today.":            "Call seven one eight, five five five, oh one three six today.",
		"That's K-I-M, R-E-E-D.":              "That's kay, eye, em, ar, ee, ee, dee.",
		"Is that A-N-A? No. A-N-N-A.":         "Is that ay, en, ay? No. ay, en, en, ay.",
		"I can come on June 19.":              "I can come on June nineteenth.",
		"See you May 2, 2026.":                "See you May second, 2026.",
		"Class starts June 12 at 6:30 p.m.":   "Class starts June twelfth at 6:30 p.m.",
		"We live at 1400 Irving Street.":      "We live at fourteen hundred Irving Street.",
		"Go to 312 Oak Avenue, please.":       "Go to three twelve Oak Avenue, please.",
		"It's 1205 Pine Road.":                "It's twelve oh five Pine Road.",
		"I am ready. It costs $4.50.":         "I am ready. It costs $4.50.",
		"May I help you? I-94 is closed.":     "May I help you? I-94 is closed.",
		"The meeting is in May 2026 or June.": "The meeting is in May 2026 or June.",
	} {
		if got := americanSpeechText(input); got != want {
			t.Errorf("%q\n got %q\nwant %q", input, got, want)
		}
	}
}

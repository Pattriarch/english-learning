package studio

import (
	"regexp"
	"strconv"
	"strings"
)

// The synthesizer reads raw digits and hyphens literally: "(312) 555-0147"
// becomes "three hundred twelve ... dash". Lessons teach how Americans actually
// say phone numbers, spelled names, dates and street numbers, so the audio must
// say them the same way. Only these unambiguous written patterns are rewritten.
var (
	speechPhone    = regexp.MustCompile(`\(?\b(\d{3})\)?[ .-]?(\d{3})[.-](\d{4})\b`)
	speechSpelling = regexp.MustCompile(`\b[A-Z](?:-[A-Z]){1,}\b`)
	speechDate     = regexp.MustCompile(`\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2})\b([^:\d]|$)`)
	speechAddress  = regexp.MustCompile(`\b(\d{3,4}) ([A-Z][a-z]+ (?:Street|Avenue|Road|Drive|Boulevard|Lane|Way|Place|Court|St\.|Ave\.|Rd\.|Dr\.))`)
)

var speechLetters = map[byte]string{
	'A': "ay", 'B': "bee", 'C': "see", 'D': "dee", 'E': "ee", 'F': "ef", 'G': "jee", 'H': "aitch", 'I': "eye",
	'J': "jay", 'K': "kay", 'L': "el", 'M': "em", 'N': "en", 'O': "oh", 'P': "pee", 'Q': "cue", 'R': "ar",
	'S': "ess", 'T': "tee", 'U': "you", 'V': "vee", 'W': "double you", 'X': "ex", 'Y': "why", 'Z': "zee",
}

var (
	speechOnes    = []string{"zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"}
	speechTens    = []string{"", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"}
	speechOrdinal = map[string]string{"one": "first", "two": "second", "three": "third", "five": "fifth", "eight": "eighth", "nine": "ninth", "twelve": "twelfth", "twenty": "twentieth", "thirty": "thirtieth"}
)

func speechNumber(n int) string {
	if n < 20 {
		return speechOnes[n]
	}
	if n%10 == 0 {
		return speechTens[n/10]
	}
	return speechTens[n/10] + "-" + speechOnes[n%10]
}

func speechOrdinalNumber(n int) string {
	words := strings.Split(speechNumber(n), "-")
	last := words[len(words)-1]
	if ordinal, ok := speechOrdinal[last]; ok {
		words[len(words)-1] = ordinal
	} else {
		words[len(words)-1] = last + "th"
	}
	return strings.Join(words, "-")
}

func speechDigits(digits string) string {
	out := make([]string, 0, len(digits))
	for _, d := range digits {
		if d == '0' {
			out = append(out, "oh")
		} else {
			out = append(out, speechOnes[d-'0'])
		}
	}
	return strings.Join(out, " ")
}

// A house number is read in pairs: 1400 → "fourteen hundred", 312 → "three twelve".
func speechHouseNumber(digits string) string {
	n, _ := strconv.Atoi(digits)
	if len(digits) == 3 {
		return speechOnes[n/100] + " " + speechPair(n%100)
	}
	return speechPair(n/100) + " " + speechPair(n%100)
}

func speechPair(n int) string {
	switch {
	case n == 0:
		return "hundred"
	case n < 10:
		return "oh " + speechOnes[n]
	default:
		return speechNumber(n)
	}
}

func americanSpeechText(text string) string {
	text = speechPhone.ReplaceAllStringFunc(text, func(match string) string {
		parts := speechPhone.FindStringSubmatch(match)
		return speechDigits(parts[1]) + ", " + speechDigits(parts[2]) + ", " + speechDigits(parts[3])
	})
	text = speechSpelling.ReplaceAllStringFunc(text, func(match string) string {
		letters := strings.Split(match, "-")
		for i, letter := range letters {
			letters[i] = speechLetters[letter[0]]
		}
		return strings.Join(letters, ", ")
	})
	text = speechDate.ReplaceAllStringFunc(text, func(match string) string {
		parts := speechDate.FindStringSubmatch(match)
		day, _ := strconv.Atoi(parts[2])
		if day < 1 || day > 31 {
			return match
		}
		return parts[1] + " " + speechOrdinalNumber(day) + parts[3]
	})
	return speechAddress.ReplaceAllStringFunc(text, func(match string) string {
		parts := speechAddress.FindStringSubmatch(match)
		return speechHouseNumber(parts[1]) + " " + parts[2]
	})
}

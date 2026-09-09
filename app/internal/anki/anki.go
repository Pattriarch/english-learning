package anki

import (
	"strings"
)

type Card struct {
	Front string
	Back  string
	Note  string
}

// TSV renders cards as headerless front\tback\tnote lines for Anki import.
func TSV(cards []Card) []byte {
	var b strings.Builder
	for _, c := range cards {
		b.WriteString(clean(c.Front))
		b.WriteByte('\t')
		b.WriteString(clean(c.Back))
		b.WriteByte('\t')
		b.WriteString(clean(c.Note))
		b.WriteByte('\n')
	}
	return []byte(b.String())
}

var cleaner = strings.NewReplacer("\t", " ", "\r\n", " ", "\r", " ", "\n", " ")

func clean(s string) string {
	return strings.TrimSpace(cleaner.Replace(s))
}

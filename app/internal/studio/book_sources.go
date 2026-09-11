package studio

import (
	"path/filepath"
	"strings"
)

// Catalog PDF names are portable relative paths, including subfolders such as
// more/. Reject Windows aliases/streams even when validation runs on Unix.
func validBookFilename(name string) bool {
	if name == "" || strings.ContainsAny(name, `\:<>"|?*`) || !strings.EqualFold(filepath.Ext(name), ".pdf") {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if part == "" || part == "." || part == ".." || strings.TrimRight(part, " .") != part {
			return false
		}
		for _, char := range part {
			if char < 32 || char == 127 {
				return false
			}
		}
		base := strings.ToUpper(strings.SplitN(part, ".", 2)[0])
		if base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" ||
			((strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) && len([]rune(base)) == 4 && strings.ContainsRune("123456789¹²³", []rune(base)[3])) {
			return false
		}
	}
	return true
}

// Pages always enumerate every PDF page, never just the chapter's endpoints.
// This preserves the exact [start, end] representation of old two-page units.
func (u libraryUnit) sourcePages() []int {
	if u.Page < 1 || u.EndPage < u.Page || u.EndPage-u.Page > 10000 {
		return nil
	}
	pages := make([]int, u.EndPage-u.Page+1)
	for i := range pages {
		pages[i] = u.Page + i
	}
	return pages
}

func (u libraryUnit) matchesSourcePages(pages []int) bool {
	if u.Page < 1 || u.EndPage < u.Page || len(pages) != u.EndPage-u.Page+1 {
		return false
	}
	for i, page := range pages {
		if page != u.Page+i {
			return false
		}
	}
	return true
}

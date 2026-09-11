package studio

import "strings"

// This groups presentation only. Case and meaning remain distinct. The current
// corpus needs whitespace/apostrophe normalization, not Unicode compatibility
// folding, stemming or spelling equivalence.
func lexiconHeadword(word string) string {
	return strings.Join(strings.Fields(strings.ReplaceAll(word, "’", "'")), " ")
}

func (all *lexiconSnapshot) indexHeadwords() {
	all.Headwords = map[string][]int{}
	for i, item := range all.Items {
		key := lexiconHeadword(item.Word)
		all.Headwords[key] = append(all.Headwords[key], i)
	}
	all.Metadata["uniqueHeadwords"] = len(all.Headwords)
	all.Metadata["sourceCollections"] = len(all.Items)
	all.Metadata["headwordGrouping"] = "case-preserving-whitespace-apostrophe-v1"
}

func (all *lexiconSnapshot) groupMatches(matches []int) [][]int {
	groups := [][]int{}
	positions := map[string]int{}
	for _, i := range matches {
		key := lexiconHeadword(all.Items[i].Word)
		position, found := positions[key]
		if !found {
			position = len(groups)
			positions[key] = position
			groups = append(groups, []int{})
		}
		groups[position] = append(groups[position], i)
	}
	return groups
}

func lexicalSummary(item lexiconItem, query string) map[string]any {
	summary := make(map[string]any, len(item.Summary)+1)
	for key, value := range item.Summary {
		summary[key] = value
	}
	if forms := item.matchingAliases(query); len(forms) > 0 {
		summary["matchedForms"] = forms
	}
	return summary
}

func (all *lexiconSnapshot) headwordMembers(indices []int, query string) []map[string]any {
	members := make([]map[string]any, 0, len(indices))
	for _, i := range indices {
		members = append(members, lexicalSummary(all.Items[i], query))
	}
	return members
}

func (all *lexiconSnapshot) headwordSummary(indices []int, query string) map[string]any {
	first := all.Items[indices[0]]
	summary := lexicalSummary(first, query)
	summary["members"] = all.headwordMembers(indices, query)
	summary["memberCount"] = len(indices)
	summary["allMemberCount"] = len(all.Headwords[lexiconHeadword(first.Word)])
	contexts, prepared := 0, 0
	for _, i := range indices {
		contexts += all.Items[i].Summary["contextCount"].(int)
		prepared += all.Items[i].Summary["preparedContexts"].(int)
	}
	summary["groupContextCount"] = contexts
	summary["groupPreparedContexts"] = prepared
	return summary
}

package studio

import (
	"encoding/json"
	"sort"
	"strings"
)

// Equivalent displayed labels share a filter. Original topic IDs and articles
// remain intact, including old links that selected either source's ID.
func (all *lexiconSnapshot) indexTopics() {
	type label struct{ ID, Title string }
	labels := []label{}
	parent, byTitle := map[string]string{}, map[string]string{}
	var find func(string) string
	find = func(id string) string {
		if parent[id] != id {
			parent[id] = find(parent[id])
		}
		return parent[id]
	}
	for _, item := range all.Items {
		var topics []label
		if raw, ok := item.Summary["topics"].(json.RawMessage); ok {
			_ = json.Unmarshal(raw, &topics)
		}
		for _, topic := range topics {
			if topic.ID == "" {
				continue
			}
			if _, found := parent[topic.ID]; !found {
				parent[topic.ID] = topic.ID
			}
			labels = append(labels, topic)
			key := strings.ReplaceAll(strings.ToLower(strings.Join(strings.Fields(topic.Title), " ")), "ё", "е")
			if key == "" {
				continue
			}
			if prior, found := byTitle[key]; found {
				a, b := find(topic.ID), find(prior)
				if a < b {
					parent[b] = a
				} else {
					parent[a] = b
				}
			} else {
				byTitle[key] = topic.ID
			}
		}
	}
	all.TopicGroups = map[string]string{}
	for id := range parent {
		all.TopicGroups[id] = find(id)
	}
	counts, titles := map[string]map[string]bool{}, map[string]string{}
	for _, topic := range labels {
		id := find(topic.ID)
		if titles[id] == "" || topic.ID == id {
			titles[id] = topic.Title
		}
	}
	for _, item := range all.Items {
		for _, topic := range item.Topics {
			id, found := all.TopicGroups[topic]
			if !found {
				continue
			}
			if counts[id] == nil {
				counts[id] = map[string]bool{}
			}
			counts[id][lexiconHeadword(item.Word)] = true
		}
	}
	topics := []map[string]any{}
	for id, words := range counts {
		topics = append(topics, map[string]any{"id": id, "title": titles[id], "count": len(words)})
	}
	sort.Slice(topics, func(i, j int) bool { return topics[i]["title"].(string) < topics[j]["title"].(string) })
	all.Metadata["topics"] = topics
}

func (all *lexiconSnapshot) topicMatches(topics []string, wanted string) bool {
	if wanted == "" {
		return true
	}
	group, known := all.TopicGroups[wanted]
	for _, id := range topics {
		if id == wanted || known && all.TopicGroups[id] == group {
			return true
		}
	}
	return false
}

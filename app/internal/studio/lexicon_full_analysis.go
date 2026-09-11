package studio

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

const lexiconFullVersion = "full-lexical-analysis-v1"

var lexiconFullHash = regexp.MustCompile(`^[a-f0-9]{64}$`)
var lexiconFullShardName = regexp.MustCompile(`^full-analysis-[a-f0-9]{24}\.json$`)
var lexiconFullRussian = regexp.MustCompile(`[А-Яа-яЁё]`)

type lexiconFullCollocation struct {
	Text string `json:"text"`
	Ru   string `json:"ru"`
}

type lexiconFullMistake struct {
	Wrong   string `json:"wrong"`
	Correct string `json:"correct"`
	Why     string `json:"why"`
}

type lexiconContextFields struct {
	ID, En, Ru, SenseID, Quality, MeaningRu, Explanation, ProductionTask string
	UsageNotes                                                           []string
	Collocations                                                         []lexiconFullCollocation
	CommonMistakes                                                       []lexiconFullMistake
	TargetSpans                                                          []lexiconSpan
	ExcludedFromStudy                                                    bool
}

// Match the UI's field-based completeness rule; a review badge alone is insufficient.
func fullLexiconContext(c lexiconContextFields, prepared bool) bool {
	if !prepared || c.ExcludedFromStudy || strings.TrimSpace(c.MeaningRu) == "" || strings.TrimSpace(c.Explanation) == "" || strings.TrimSpace(c.ProductionTask) == "" {
		return false
	}
	notes, collocations, mistakes := 0, 0, 0
	for _, note := range c.UsageNotes {
		if strings.TrimSpace(note) != "" {
			notes++
		}
	}
	for _, item := range c.Collocations {
		if strings.TrimSpace(item.Text) != "" && strings.TrimSpace(item.Ru) != "" {
			collocations++
		}
	}
	for _, item := range c.CommonMistakes {
		if strings.TrimSpace(item.Wrong) != "" && strings.TrimSpace(item.Correct) != "" && strings.TrimSpace(item.Why) != "" {
			mistakes++
		}
	}
	return notes >= 2 && collocations >= 2 && mistakes >= 1
}

type lexiconFullFile struct {
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
	Rows   int    `json:"rows,omitempty"`
}

type lexiconFullManifest struct {
	Version       string            `json:"version"`
	TargetVariety string            `json:"targetVariety"`
	BaseFiles     []lexiconFullFile `json:"baseFiles"`
	Shards        []lexiconFullFile `json:"shards"`
	Rows          int               `json:"rows"`
	TargetRows    int               `json:"targetRows"`
	TargetEntries int               `json:"targetEntries"`
	Complete      bool              `json:"complete"`
	Source        map[string]string `json:"source"`
}

type lexiconFullReview struct {
	InputSHA256          string `json:"inputSHA256"`
	OutputSHA256         string `json:"outputSHA256"`
	ReceiptSHA256        string `json:"receiptSHA256"`
	SemanticReviewSHA256 string `json:"semanticReviewSHA256"`
}

type lexiconFullRow struct {
	RowID               string                    `json:"rowId"`
	EntryID             string                    `json:"entryId"`
	ContextID           string                    `json:"contextId"`
	SourceContextSHA256 string                    `json:"sourceContextSHA256"`
	Action              string                    `json:"action"`
	En                  string                    `json:"en"`
	Ru                  string                    `json:"ru"`
	MeaningEn           string                    `json:"meaningEn"`
	MeaningRu           string                    `json:"meaningRu"`
	Explanation         string                    `json:"explanation"`
	ProductionTask      string                    `json:"productionTask"`
	ReplacementReason   string                    `json:"replacementReason"`
	POS                 string                    `json:"pos"`
	UsageNotes          []string                  `json:"usageNotes"`
	Collocations        []lexiconFullCollocation  `json:"collocations"`
	CommonMistakes      []lexiconFullMistake      `json:"commonMistakes"`
	RegisterTags        []string                  `json:"registerTags"`
	TargetSpans         []lexiconSpan             `json:"targetSpans"`
	Review              lexiconFullReview         `json:"review"`
	ExampleRevision     int                       `json:"exampleRevision,omitempty"`
	PreviousAnalyses    []lexiconPreviousAnalysis `json:"previousAnalyses,omitempty"`
}

type lexiconPreviousAnalysis struct {
	ExampleRevision int            `json:"exampleRevision"`
	ReceiptSHA256   string         `json:"receiptSHA256"`
	Row             lexiconFullRow `json:"row"`
}

func (row lexiconFullRow) exampleRevision() int {
	if row.ExampleRevision == 0 {
		return 1
	}
	return row.ExampleRevision
}

type lexiconFullPublication struct {
	Manifest lexiconFullManifest
	SHA256   string
	ByEntry  map[string][]lexiconFullRow
	baseSeen map[string]bool
	used     map[string]bool
	entries  int
	contexts int
}

func lexiconDigest(raw []byte) string {
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}

func readLexiconFullFile(dir, name string, maxSize int64) ([]byte, os.FileInfo, error) {
	path := filepath.Join(dir, name)
	info, err := os.Lstat(path)
	if err != nil {
		return nil, nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > maxSize {
		return nil, nil, fmt.Errorf("invalid full-analysis file: %s", name)
	}
	raw, err := os.ReadFile(path)
	if err == nil && int64(len(raw)) > maxSize {
		err = errors.New("full-analysis file exceeds its size limit")
	}
	return raw, info, err
}

// The optional manifest is read on every request. Content-addressed shard stamps
// join the normal base-file cache stamp; changed files are rehashed before use.
func readLexiconFullManifest(dir string) (*lexiconFullPublication, []string, error) {
	raw, _, err := readLexiconFullFile(dir, "full-analysis.json", 2<<20)
	if errors.Is(err, os.ErrNotExist) {
		return nil, []string{"full-analysis.json:absent"}, nil
	}
	if err != nil {
		return nil, nil, err
	}
	p := &lexiconFullPublication{SHA256: lexiconDigest(raw), ByEntry: map[string][]lexiconFullRow{}, baseSeen: map[string]bool{}, used: map[string]bool{}}
	m := &p.Manifest
	if err := json.Unmarshal(raw, m); err != nil {
		return nil, nil, errors.New("invalid full-analysis manifest JSON")
	}
	if m.Version != lexiconFullVersion || m.TargetVariety != "en-US" || m.Rows < 1 || m.Rows > m.TargetRows || m.TargetRows > 100000 || m.TargetEntries < 1 || m.TargetEntries > m.TargetRows || m.Complete != (m.Rows == m.TargetRows) || len(m.Shards) == 0 || len(m.Shards) > 1000 {
		return nil, nil, errors.New("invalid full-analysis publication scope")
	}
	if m.Source["id"] != lexiconFullVersion || m.Source["license"] != "original-project-content" || strings.TrimSpace(m.Source["title"]) == "" || strings.TrimSpace(m.Source["author"]) == "" {
		return nil, nil, errors.New("missing full-analysis authorship")
	}
	allowed := map[string]bool{"entries.json": true, "coca-extension.json": true, "american-phrases.json": true}
	if len(m.BaseFiles) != len(allowed) {
		return nil, nil, errors.New("full-analysis must bind all base files")
	}
	for _, file := range m.BaseFiles {
		if !allowed[file.Name] || !lexiconFullHash.MatchString(file.SHA256) {
			return nil, nil, errors.New("invalid or duplicate full-analysis base binding")
		}
		delete(allowed, file.Name)
	}
	stamps, seen, rows := []string{"full-analysis.json:" + p.SHA256}, map[string]bool{}, 0
	for _, shard := range m.Shards {
		if !lexiconFullShardName.MatchString(shard.Name) || seen[shard.Name] || !lexiconFullHash.MatchString(shard.SHA256) || shard.Rows < 1 || shard.Rows > 400 {
			return nil, nil, errors.New("invalid or duplicate full-analysis shard")
		}
		seen[shard.Name] = true
		info, err := os.Lstat(filepath.Join(dir, shard.Name))
		if err != nil || !info.Mode().IsRegular() || info.Size() > 24<<20 {
			return nil, nil, fmt.Errorf("missing or invalid full-analysis shard: %s", shard.Name)
		}
		stamps = append(stamps, fmt.Sprintf("%s:%d:%d", shard.Name, info.Size(), info.ModTime().UnixNano()))
		rows += shard.Rows
	}
	if rows != m.Rows {
		return nil, nil, errors.New("full-analysis shard totals disagree")
	}
	return p, stamps, nil
}

func (p *lexiconFullPublication) loadShards(dir string) error {
	seen := map[string]bool{}
	for _, file := range p.Manifest.Shards {
		raw, _, err := readLexiconFullFile(dir, file.Name, 24<<20)
		if err != nil {
			return err
		}
		if lexiconDigest(raw) != file.SHA256 {
			return fmt.Errorf("full-analysis shard hash changed: %s", file.Name)
		}
		var shard struct {
			Version string           `json:"version"`
			Rows    []lexiconFullRow `json:"rows"`
		}
		if err := json.Unmarshal(raw, &shard); err != nil || shard.Version != lexiconFullVersion || len(shard.Rows) != file.Rows {
			return errors.New("invalid full-analysis shard content")
		}
		for _, row := range shard.Rows {
			if err := validateLexiconFullRow(row); err != nil {
				return fmt.Errorf("invalid full-analysis row %s: %w", row.RowID, err)
			}
			if seen[row.RowID] {
				return errors.New("duplicate full-analysis row target")
			}
			seen[row.RowID] = true
			p.ByEntry[row.EntryID] = append(p.ByEntry[row.EntryID], row)
		}
	}
	return nil
}

func validLexiconFullText(text string, min int, russian bool) bool {
	n := utf8.RuneCountInString(strings.TrimSpace(text))
	return n >= min && utf8.RuneCountInString(text) <= 3500 && (!russian || lexiconFullRussian.MatchString(text))
}

func validateLexiconFullRow(row lexiconFullRow) error {
	if err := validateLexiconAnalysisHistory(row); err != nil {
		return err
	}
	return validateLexiconFullRowFields(row)
}

// Revisions are original examples, not additional active teaching contexts.
// Keep the exact preceding analyses so existing work still names its old task.
func validateLexiconAnalysisHistory(row lexiconFullRow) error {
	revision := row.exampleRevision()
	if revision < 1 || revision > 32 || len(row.PreviousAnalyses) != revision-1 || revision > 1 && row.Action != "replace" {
		return errors.New("invalid example revision history")
	}
	seenEnglish := map[string]bool{row.En: true}
	for index, previous := range row.PreviousAnalyses {
		old := previous.Row
		if previous.ExampleRevision != index+1 || old.ExampleRevision != 0 || len(old.PreviousAnalyses) != 0 ||
			previous.ReceiptSHA256 != old.Review.ReceiptSHA256 || !lexiconFullHash.MatchString(previous.ReceiptSHA256) ||
			old.RowID != row.RowID || old.EntryID != row.EntryID || old.ContextID != row.ContextID || old.SourceContextSHA256 != row.SourceContextSHA256 ||
			index > 0 && old.Action != "replace" || seenEnglish[old.En] {
			return errors.New("example history changed its source, receipt or sequence")
		}
		if err := validateLexiconFullRowFields(old); err != nil {
			return fmt.Errorf("invalid archived example analysis: %w", err)
		}
		seenEnglish[old.En] = true
	}
	return nil
}

func validateLexiconFullRowFields(row lexiconFullRow) error {
	if !safeID.MatchString(row.EntryID) || !safeID.MatchString(row.ContextID) || row.RowID != row.EntryID+":"+row.ContextID || !lexiconFullHash.MatchString(row.SourceContextSHA256) {
		return errors.New("invalid stable source target")
	}
	for _, digest := range []string{row.Review.InputSHA256, row.Review.OutputSHA256, row.Review.ReceiptSHA256, row.Review.SemanticReviewSHA256} {
		if !lexiconFullHash.MatchString(digest) {
			return errors.New("missing separate semantic-review receipt")
		}
	}
	for _, field := range []struct {
		value string
		min   int
		ru    bool
	}{{row.En, 2, false}, {row.Ru, 3, true}, {row.MeaningEn, 5, false}, {row.MeaningRu, 2, true}, {row.Explanation, 100, true}, {row.ProductionTask, 40, true}} {
		if !validLexiconFullText(field.value, field.min, field.ru) {
			return errors.New("incomplete contextual teaching material")
		}
	}
	if row.Action != "keep" && row.Action != "replace" || row.Action == "keep" && row.ReplacementReason != "" || row.Action == "replace" && !validLexiconFullText(row.ReplacementReason, 15, true) {
		return errors.New("invalid source-retention decision")
	}
	if !strings.Contains("|noun|verb|adjective|adverb|pronoun|determiner|preposition|conjunction|interjection|abbreviation|symbol|numeral|combining-form|phrase|infinitive-marker|particle|", "|"+row.POS+"|") || row.POS == "" {
		return errors.New("invalid contextual part of speech")
	}
	if !validLexiconSpans(row.En, row.TargetSpans) || len(row.UsageNotes) < 2 || len(row.UsageNotes) > 4 || len(row.Collocations) < 2 || len(row.Collocations) > 4 || len(row.CommonMistakes) < 1 || len(row.CommonMistakes) > 2 || row.RegisterTags == nil || len(row.RegisterTags) > 20 {
		return errors.New("invalid contextual practice structure")
	}
	for _, note := range row.UsageNotes {
		if !validLexiconFullText(note, 15, true) {
			return errors.New("incomplete construction note")
		}
	}
	for _, item := range row.Collocations {
		if !validLexiconFullText(item.Text, 2, false) || !validLexiconFullText(item.Ru, 2, true) {
			return errors.New("untranslated collocation")
		}
	}
	for _, item := range row.CommonMistakes {
		if !validLexiconFullText(item.Wrong, 2, false) || !validLexiconFullText(item.Correct, 2, false) || !validLexiconFullText(item.Why, 20, true) || strings.TrimSpace(item.Wrong) == strings.TrimSpace(item.Correct) {
			return errors.New("invalid contextual pitfall")
		}
	}
	for _, tag := range row.RegisterTags {
		if !validLexiconFullText(tag, 1, false) || len(tag) > 100 {
			return errors.New("invalid register tag")
		}
	}
	return nil
}

func (p *lexiconFullPublication) bindBase(name string, raw []byte) error {
	for _, file := range p.Manifest.BaseFiles {
		if file.Name == name {
			if p.baseSeen[name] || lexiconDigest(raw) != file.SHA256 {
				return fmt.Errorf("full-analysis base hash changed: %s", name)
			}
			p.baseSeen[name] = true
			return nil
		}
	}
	return errors.New("unbound full-analysis base")
}

func (p *lexiconFullPublication) attribution() map[string]any {
	return map[string]any{"sourceId": lexiconFullVersion, "kind": "original-ai-reviewed", "license": "original-project-content", "attribution": "English project; AI drafting and separate semantic review", "checkedAt": p.Manifest.Source["checkedAt"]}
}

func lexicalRaw(value any) json.RawMessage {
	raw, _ := json.Marshal(value)
	return raw
}

func rawLexicalString(raw json.RawMessage) string {
	var text string
	_ = json.Unmarshal(raw, &text)
	return text
}

func (p *lexiconFullPublication) apply(raw json.RawMessage) (json.RawMessage, error) {
	var entry map[string]json.RawMessage
	if err := json.Unmarshal(raw, &entry); err != nil {
		return nil, err
	}
	id := rawLexicalString(entry["id"])
	var contexts []map[string]json.RawMessage
	var senses []map[string]json.RawMessage
	if err := json.Unmarshal(entry["contexts"], &contexts); err != nil {
		return nil, err
	}
	if rawSenses, exists := entry["senses"]; exists {
		if err := json.Unmarshal(rawSenses, &senses); err != nil {
			return nil, err
		}
	}
	p.entries++
	contextIDs, senseIDs := map[string]bool{}, map[string]bool{}
	for _, context := range contexts {
		cid := rawLexicalString(context["id"])
		if contextIDs[cid] {
			return nil, errors.New("duplicate source context")
		}
		contextIDs[cid] = true
		var excluded bool
		_ = json.Unmarshal(context["excludedFromStudy"], &excluded)
		if !excluded {
			p.contexts++
		}
	}
	for _, sense := range senses {
		senseIDs[rawLexicalString(sense["id"])] = true
	}
	rows := p.ByEntry[id]
	if len(rows) == 0 {
		return raw, nil
	}
	word, display := rawLexicalString(entry["word"]), rawLexicalString(entry["displayHeadword"])
	for _, published := range rows {
		var old map[string]json.RawMessage
		for _, context := range contexts {
			if rawLexicalString(context["id"]) == published.ContextID {
				old = context
				break
			}
		}
		if old == nil {
			return nil, fmt.Errorf("full-analysis context target is missing: %s", published.RowID)
		}
		var excluded bool
		_ = json.Unmarshal(old["excludedFromStudy"], &excluded)
		if excluded || p.used[published.RowID] {
			return nil, errors.New("full-analysis target is archived or repeated")
		}
		versions := make([]lexiconFullRow, 0, len(published.PreviousAnalyses)+1)
		for _, previous := range published.PreviousAnalyses {
			version := previous.Row
			version.ExampleRevision = previous.ExampleRevision
			versions = append(versions, version)
		}
		versions = append(versions, published)
		for _, row := range versions {
			prompt := strings.ToLower(row.ProductionTask)
			if (word == "" || !strings.Contains(prompt, strings.ToLower(word))) && (display == "" || !strings.Contains(prompt, strings.ToLower(display))) {
				return nil, errors.New("full-analysis production task omits its headword")
			}
			oldEn := rawLexicalString(old["en"])
			var oldSpans []lexiconSpan
			_ = json.Unmarshal(old["targetSpans"], &oldSpans)
			if row.Action == "keep" {
				if row.En != oldEn || string(lexicalRaw(row.TargetSpans)) != string(lexicalRaw(oldSpans)) {
					return nil, errors.New("keep changed English or selected source token")
				}
			} else if row.En == oldEn {
				return nil, errors.New("replacement must have a new example")
			}
			if row.Action == "replace" {
				for _, span := range row.TargetSpans {
					if normalizeLexiconWord(span.Text) != normalizeLexiconWord(word) && (display == "" || normalizeLexiconWord(span.Text) != normalizeLexiconWord(display)) {
						return nil, errors.New("replacement highlights a different headword")
					}
				}
			}
			original := lexicalRaw(old)
			oldRu, oldTranslation := rawLexicalString(old["ru"]), old["translationSource"]
			target := old
			contextID := row.ContextID
			if row.Action == "replace" {
				contextID += fmt.Sprintf("-rich-v%d", row.exampleRevision())
				if !safeID.MatchString(contextID) || contextIDs[contextID] {
					return nil, errors.New("replacement context ID collides or is invalid")
				}
				contextIDs[contextID] = true
				old["excludedFromStudy"], old["exclusionReason"] = lexicalRaw(true), lexicalRaw(row.ReplacementReason)
				old["replacedBy"], old["selectionReviewSourceId"] = lexicalRaw(contextID), lexicalRaw(lexiconFullVersion)
				target = map[string]json.RawMessage{"id": lexicalRaw(contextID), "source": lexicalRaw(p.attribution()), "derivedFrom": lexicalRaw(map[string]any{"entryId": id, "contextId": row.ContextID, "source": old["source"], "sourceContextSHA256": row.SourceContextSHA256}), "replacementReason": lexicalRaw(row.ReplacementReason)}
				contexts = append(contexts, target)
			}
			senseID := row.ContextID + fmt.Sprintf("-rich-sense-v%d", row.exampleRevision())
			if !safeID.MatchString(senseID) || senseIDs[senseID] {
				return nil, errors.New("contextual sense ID collides or is invalid")
			}
			senseIDs[senseID] = true
			senses = append(senses, map[string]json.RawMessage{"id": lexicalRaw(senseID), "pos": lexicalRaw(row.POS), "definition": lexicalRaw(row.MeaningEn), "definitionRu": lexicalRaw(row.MeaningRu), "source": lexicalRaw(p.attribution()), "review": lexicalRaw(row.Review)})
			var history []json.RawMessage
			if previous, ok := target["analysisHistory"]; ok {
				if err := json.Unmarshal(previous, &history); err != nil {
					return nil, errors.New("invalid previous contextual analysis history")
				}
			}
			history = append(history, lexicalRaw(map[string]any{"previousContext": original, "sourceContextSHA256": row.SourceContextSHA256, "review": row.Review}))
			for key, value := range map[string]any{"en": row.En, "ru": row.Ru, "meaningRu": row.MeaningRu, "explanation": row.Explanation, "productionTask": row.ProductionTask, "usageNotes": row.UsageNotes, "collocations": row.Collocations, "commonMistakes": row.CommonMistakes, "registerTags": row.RegisterTags, "targetSpans": row.TargetSpans, "senseId": senseID, "quality": "ai-context-reviewed", "variety": "en-US-compatible", "analysisHistory": history, "analysisSource": p.attribution(), "review": row.Review, "sourceContextSHA256": row.SourceContextSHA256} {
				target[key] = lexicalRaw(value)
			}
			translation := p.attribution()
			translation["derivedFrom"] = map[string]any{"englishSource": old["source"], "previousTranslationSource": oldTranslation}
			if row.Action == "keep" && row.Ru == oldRu && len(oldTranslation) > 0 && string(oldTranslation) != "null" {
				target["translationSource"] = oldTranslation
			} else {
				target["translationSource"] = lexicalRaw(translation)
			}
			// The new reviewed tags supersede older free-form register guidance; the
			// original wording remains in the immutable previous-context history.
			delete(target, "register")
			delete(target, "usAlternative")
			old = target
		}
		p.used[published.RowID] = true
	}
	entry["contexts"], entry["senses"] = lexicalRaw(contexts), lexicalRaw(senses)
	return lexicalRaw(entry), nil
}

func (p *lexiconFullPublication) finish() (map[string]any, error) {
	if len(p.baseSeen) != len(p.Manifest.BaseFiles) || len(p.used) != p.Manifest.Rows || p.entries != p.Manifest.TargetEntries || p.contexts != p.Manifest.TargetRows {
		return nil, errors.New("full-analysis targets or source coverage do not match the published manifest")
	}
	return map[string]any{"version": lexiconFullVersion, "complete": p.Manifest.Complete, "rows": len(p.used), "targetRows": p.contexts, "targetEntries": p.entries, "source": p.Manifest.Source, "manifestSHA256": p.SHA256, "reviewMethod": "AI drafting and separate semantic review", "humanVerified": false}, nil
}

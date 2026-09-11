package studio

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const lexiconImagesVersion = "context-images-v1"

var lexiconImagePath = regexp.MustCompile(`^/assets/(vocabulary-scenes|learning-figures)/[a-z0-9-]+\.png$`)

func validLexiconDigest(value string) bool {
	return len(value) == 64 && value == strings.ToLower(value) && isHex(value)
}

type lexiconImageAsset struct {
	ID            string `json:"id"`
	Src           string `json:"src"`
	SHA256        string `json:"sha256"`
	Alt           string `json:"alt"`
	SourceID      string `json:"sourceId"`
	AssociationRu string `json:"associationRu"`
}

type lexiconImageBinding struct {
	EntryID         string `json:"entryId"`
	ContextID       string `json:"contextId"`
	EnglishSHA256   string `json:"englishSHA256"`
	SenseID         string `json:"senseId"`
	MeaningRuSHA256 string `json:"meaningRuSHA256"`
	ImageID         string `json:"imageId"`
	Evidence        string `json:"evidence"`
}

// This optional overlay never changes the immutable source banks or publication.
// English and selected meaning are checked after the full analysis has applied.
type lexiconImageOverlay struct {
	Version  string                `json:"version"`
	Assets   []lexiconImageAsset   `json:"assets"`
	Bindings []lexiconImageBinding `json:"bindings"`
	Source   map[string]any        `json:"source"`
	byEntry  map[string][]lexiconImageBinding
	verified map[string]lexiconImageAsset
	applied  int
}

func readLexiconContextImages(dir, web string) (*lexiconImageOverlay, []string, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "context-images.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, []string{"context-images:absent"}, nil
	}
	if err != nil {
		return nil, nil, err
	}
	var overlay lexiconImageOverlay
	if err := json.Unmarshal(raw, &overlay); err != nil || overlay.Version != lexiconImagesVersion {
		return nil, nil, errors.New("invalid context image overlay")
	}
	overlay.byEntry = map[string][]lexiconImageBinding{}
	overlay.verified = map[string]lexiconImageAsset{}
	stamps := []string{"context-images:" + lexiconDigest(raw)}
	assetIDs := map[string]bool{}
	root, rootErr := os.OpenRoot(web)
	if rootErr == nil {
		defer root.Close()
	}
	for _, asset := range overlay.Assets {
		if !safeID.MatchString(asset.ID) || assetIDs[asset.ID] || !lexiconImagePath.MatchString(asset.Src) || !validLexiconDigest(asset.SHA256) || strings.TrimSpace(asset.Alt) == "" || strings.TrimSpace(asset.SourceID) == "" || strings.TrimSpace(asset.AssociationRu) == "" {
			return nil, nil, errors.New("invalid context image asset")
		}
		assetIDs[asset.ID] = true
		// Images are optional: a missing/changed asset removes its bindings, not
		// the learner's access to all dictionary text. Hashes enter the cache key.
		if rootErr != nil {
			stamps = append(stamps, asset.ID+":unavailable")
			continue
		}
		image, err := root.ReadFile(strings.TrimPrefix(asset.Src, "/"))
		if err != nil {
			stamps = append(stamps, asset.ID+":unavailable")
			continue
		}
		digest := lexiconDigest(image)
		stamps = append(stamps, asset.ID+":"+digest)
		if digest == asset.SHA256 && len(image) < 12<<20 && http.DetectContentType(image) == "image/png" {
			overlay.verified[asset.ID] = asset
		}
	}
	bindings := map[string]bool{}
	for _, binding := range overlay.Bindings {
		key := binding.EntryID + ":" + binding.ContextID
		if !safeID.MatchString(binding.EntryID) || !safeID.MatchString(binding.ContextID) || !safeID.MatchString(binding.SenseID) || !validLexiconDigest(binding.EnglishSHA256) || !validLexiconDigest(binding.MeaningRuSHA256) || !assetIDs[binding.ImageID] || bindings[key] || len(strings.TrimSpace(binding.Evidence)) < 30 {
			return nil, nil, errors.New("invalid or duplicated context image binding")
		}
		bindings[key] = true
		overlay.byEntry[binding.EntryID] = append(overlay.byEntry[binding.EntryID], binding)
	}
	return &overlay, stamps, nil
}

func (overlay *lexiconImageOverlay) apply(raw json.RawMessage) (json.RawMessage, error) {
	if overlay == nil {
		return raw, nil
	}
	var entry map[string]json.RawMessage
	if err := json.Unmarshal(raw, &entry); err != nil {
		return nil, err
	}
	bindings := overlay.byEntry[rawLexicalString(entry["id"])]
	if len(bindings) == 0 {
		return raw, nil
	}
	var contexts []struct {
		ID, En, SenseID, MeaningRu string
		ExcludedFromStudy          bool
	}
	var images []json.RawMessage
	if err := json.Unmarshal(entry["contexts"], &contexts); err != nil {
		return nil, err
	}
	if previous, ok := entry["images"]; ok {
		if err := json.Unmarshal(previous, &images); err != nil {
			return nil, err
		}
	}
	for _, binding := range bindings {
		asset, available := overlay.verified[binding.ImageID]
		if !available {
			continue
		}
		for _, context := range contexts {
			if context.ExcludedFromStudy || context.ID != binding.ContextID || context.SenseID != binding.SenseID || lexiconDigest([]byte(context.En)) != binding.EnglishSHA256 || lexiconDigest([]byte(context.MeaningRu)) != binding.MeaningRuSHA256 {
				continue
			}
			images = append(images, lexicalRaw(map[string]any{
				"sceneId": asset.ID, "src": asset.Src, "sha256": asset.SHA256, "alt": asset.Alt,
				"contextId": binding.ContextID, "englishSHA256": binding.EnglishSHA256,
				"senseId": binding.SenseID, "meaningRuSHA256": binding.MeaningRuSHA256,
				"sourceId": asset.SourceID, "association": "context-checked-scene", "associationRu": asset.AssociationRu,
				"bindingEvidence": binding.Evidence, "overlayVersion": overlay.Version,
			}))
			overlay.applied++
			break
		}
	}
	if len(images) == 0 {
		return raw, nil
	}
	entry["images"] = lexicalRaw(images)
	return json.Marshal(entry)
}

func (overlay *lexiconImageOverlay) metadata() map[string]any {
	return map[string]any{
		"version": overlay.Version, "bindings": len(overlay.Bindings), "applied": overlay.applied,
		"inactive": len(overlay.Bindings) - overlay.applied, "verifiedAssets": len(overlay.verified),
		"unavailableAssets": len(overlay.Assets) - len(overlay.verified),
		"scope":             fmt.Sprintf("%d additional context-bound illustrations; existing entry images retained separately.", overlay.applied),
	}
}

package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

const claudeTimeout = 90 * time.Second

const extractSystemPrompt = `You help a Russian-speaking learner of English build Anki cards from screenshots.

The user screenshots English text he wants to learn. Your job:

1. Find THE single most important English phrase, collocation or idiom in the image.
   - It is a phrase, not a whole paragraph or a whole sentence dump. Typically 2-6 words.
   - If several candidates exist, prefer the one that is highlighted, selected, underlined,
     bolded or visually centred.
   - Normalise it to a clean dictionary-ish form (drop leading articles only if they are not
     part of the expression, keep the phrase natural).
2. Give a natural Russian translation of that phrase - how a Russian would actually say it,
   not a word-by-word calque.
3. Write ONE fresh example sentence in English that uses the phrase in a context CLEARLY
   DIFFERENT from the screenshot's context. Keep it short and vivid.
4. Translate that example sentence into natural Russian.
5. Produce image_query: 2-4 English words for a stock-photo search that would concretely
   illustrate the phrase. For abstract phrases pick a concrete visual metaphor
   (e.g. "burn bridges" -> "burning wooden bridge").

If the image contains no usable English phrase at all (no English text, unreadable, or only
UI chrome like menu labels and buttons), return every field as an empty string.

Return only the JSON object.`

type claudeClient struct {
	client anthropic.Client
	model  anthropic.Model
}

func newClaudeClient(cfg Config) *claudeClient {
	model := anthropic.Model(strings.TrimSpace(cfg.Model))
	if model == "" {
		model = "claude-opus-5"
	}
	return &claudeClient{
		// Сорвавшийся вызов уводит скрин в failed/ и требует ручного повтора,
		// поэтому перебираем сетевые сбои настойчивее, чем по умолчанию (2).
		client: anthropic.NewClient(
			option.WithAPIKey(cfg.AnthropicAPIKey),
			option.WithMaxRetries(5),
		),
		model:  model,
	}
}

var extractionSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"phrase":         map[string]any{"type": "string", "description": "The single most important English phrase from the image; empty string if none."},
		"translation_ru": map[string]any{"type": "string", "description": "Natural Russian translation of the phrase."},
		"example_en":     map[string]any{"type": "string", "description": "One fresh English sentence using the phrase in a different context."},
		"example_ru":     map[string]any{"type": "string", "description": "Russian translation of the example sentence."},
		"image_query":    map[string]any{"type": "string", "description": "2-4 English words for a stock-photo search illustrating the phrase."},
	},
	"required":             []any{"phrase", "translation_ru", "example_en", "example_ru", "image_query"},
	"additionalProperties": false,
}

func (c *claudeClient) Extract(imagePath string) (Extraction, error) {
	data, err := os.ReadFile(imagePath)
	if err != nil {
		return Extraction{}, fmt.Errorf("не удалось прочитать %s: %w", imagePath, err)
	}
	mediaType, err := detectMediaType(imagePath, data)
	if err != nil {
		return Extraction{}, err
	}
	data, mediaType = shrinkForAPI(data, mediaType)

	ctx, cancel := context.WithTimeout(context.Background(), claudeTimeout)
	defer cancel()

	resp, err := c.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     c.model,
		MaxTokens: 16000,
		System:    []anthropic.TextBlockParam{{Text: extractSystemPrompt}},
		OutputConfig: anthropic.OutputConfigParam{
			Format: anthropic.JSONOutputFormatParam{Schema: extractionSchema},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(
				anthropic.NewImageBlockBase64(mediaType, base64.StdEncoding.EncodeToString(data)),
				anthropic.NewTextBlock("Extract the key English phrase from this screenshot."),
			),
		},
	})
	if err != nil {
		return Extraction{}, fmt.Errorf("Claude API: %w", err)
	}

	var sb strings.Builder
	for _, block := range resp.Content {
		if text, ok := block.AsAny().(anthropic.TextBlock); ok {
			sb.WriteString(text.Text)
		}
	}
	return parseExtraction(sb.String())
}

// parseExtraction is tolerant of fenced or prose-wrapped JSON so the same code path
// works whether the model honoured the schema or not.
func parseExtraction(raw string) (Extraction, error) {
	body := strings.TrimSpace(raw)
	if body == "" {
		return Extraction{}, fmt.Errorf("Claude вернул пустой ответ: %w", errNoPhrase)
	}
	if i := strings.Index(body, "{"); i >= 0 {
		if j := strings.LastIndex(body, "}"); j > i {
			body = body[i : j+1]
		}
	}

	var e Extraction
	if err := json.Unmarshal([]byte(body), &e); err != nil {
		return Extraction{}, fmt.Errorf("не разобрать ответ Claude (%.200s): %w", raw, err)
	}

	e.Phrase = strings.TrimSpace(e.Phrase)
	e.TranslationRU = strings.TrimSpace(e.TranslationRU)
	e.ExampleEN = strings.TrimSpace(e.ExampleEN)
	e.ExampleRU = strings.TrimSpace(e.ExampleRU)
	e.ImageQuery = strings.TrimSpace(e.ImageQuery)

	if e.Phrase == "" {
		return Extraction{}, fmt.Errorf("Claude не выделил фразу: %w", errNoPhrase)
	}
	return e, nil
}

func detectMediaType(path string, data []byte) (string, error) {
	switch {
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		return "image/png", nil
	case bytes.HasPrefix(data, []byte{0xFF, 0xD8, 0xFF}):
		return "image/jpeg", nil
	case bytes.HasPrefix(data, []byte("GIF87a")), bytes.HasPrefix(data, []byte("GIF89a")):
		return "image/gif", nil
	case len(data) >= 12 && bytes.HasPrefix(data, []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP")):
		return "image/webp", nil
	}

	switch strings.ToLower(filepath.Ext(path)) {
	case ".png":
		return "image/png", nil
	case ".jpg", ".jpeg":
		return "image/jpeg", nil
	case ".gif":
		return "image/gif", nil
	case ".webp":
		return "image/webp", nil
	}
	return "", fmt.Errorf("неподдерживаемый формат изображения %q: нужен PNG, JPEG, WebP или GIF", filepath.Ext(path))
}

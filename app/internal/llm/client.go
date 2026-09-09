package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	apiURL           = "https://api.anthropic.com/v1/messages"
	anthropicVersion = "2023-06-01"
	DefaultModel     = "claude-sonnet-5"
	maxTokens        = 4000
)

type Client struct {
	apiKey string
	model  string
	http   *http.Client
}

func New(apiKey, model string) *Client {
	if model == "" {
		model = DefaultModel
	}
	return &Client{
		apiKey: apiKey,
		model:  model,
		http:   &http.Client{Timeout: 3 * time.Minute},
	}
}

func (c *Client) Model() string { return c.model }

type message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type request struct {
	Model     string    `json:"model"`
	MaxTokens int       `json:"max_tokens"`
	System    string    `json:"system"`
	Messages  []message `json:"messages"`
}

type response struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	Error *struct {
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"error"`
}

// AnalyzeLetter sends the letter to Claude and decodes the strict-JSON breakdown.
func (c *Client) AnalyzeLetter(ctx context.Context, prompt, letterText, topicsCompact string) (*Analysis, error) {
	if c.apiKey == "" {
		return nil, fmt.Errorf("ANTHROPIC_API_KEY is not set")
	}
	raw, err := c.complete(ctx, systemPrompt, userPrompt(prompt, letterText, topicsCompact))
	if err != nil {
		return nil, err
	}
	return ParseAnalysis(raw)
}

func (c *Client) complete(ctx context.Context, system, user string) (string, error) {
	body, err := json.Marshal(request{
		Model:     c.model,
		MaxTokens: maxTokens,
		System:    system,
		Messages:  []message{{Role: "user", Content: user}},
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("anthropic-version", anthropicVersion)

	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return "", err
	}
	var parsed response
	if err := json.Unmarshal(data, &parsed); err != nil {
		return "", fmt.Errorf("claude api %d: %s", resp.StatusCode, truncate(string(data), 300))
	}
	if parsed.Error != nil {
		return "", fmt.Errorf("claude api %s: %s", parsed.Error.Type, parsed.Error.Message)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("claude api %d: %s", resp.StatusCode, truncate(string(data), 300))
	}
	var b strings.Builder
	for _, part := range parsed.Content {
		if part.Type == "text" {
			b.WriteString(part.Text)
		}
	}
	if b.Len() == 0 {
		return "", fmt.Errorf("claude api returned no text")
	}
	return b.String(), nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

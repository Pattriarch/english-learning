package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// CLIClient runs the letter analysis through the local `claude` binary instead of
// the HTTP API, so the work is billed to the Claude Code subscription and no
// ANTHROPIC_API_KEY is needed.
//
// The flags below strip everything Claude Code normally loads for an interactive
// session — tools, MCP servers, project settings, CLAUDE.md. Without them every
// call would carry ~30k tokens of prompt it has no use for.
type CLIClient struct {
	bin     string
	model   string
	timeout time.Duration
}

const cliDefaultModel = "sonnet"

func NewCLI(bin, model string) *CLIClient {
	if bin == "" {
		bin = "claude"
	}
	if model == "" {
		model = cliDefaultModel
	}
	return &CLIClient{bin: bin, model: model, timeout: 4 * time.Minute}
}

func (c *CLIClient) Model() string { return c.model }

// Available reports whether the binary can be found, so startup can say so
// plainly instead of failing on the first letter.
func (c *CLIClient) Available() error {
	if _, err := exec.LookPath(c.bin); err != nil {
		return fmt.Errorf("%q not found in PATH: %w", c.bin, err)
	}
	return nil
}

func (c *CLIClient) AnalyzeLetter(ctx context.Context, prompt, letterText, topicsCompact string) (*Analysis, error) {
	raw, err := c.complete(ctx, systemPrompt, userPrompt(prompt, letterText, topicsCompact))
	if err != nil {
		return nil, err
	}
	return ParseAnalysis(raw)
}

func (c *CLIClient) complete(ctx context.Context, system, user string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, c.bin,
		"--print",
		"--system-prompt", system,
		"--exclude-dynamic-system-prompt-sections",
		"--restricted",
		"--strict-mcp-config",
		"--setting-sources", "",
		"--allowedTools", "",
		"--max-turns", "1",
		"--model", c.model,
		"--output-format", "json",
	)
	cmd.Stdin = strings.NewReader(user)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return "", fmt.Errorf("claude cli timed out after %s", c.timeout)
		}
		return "", fmt.Errorf("claude cli: %w: %s", err, truncate(strings.TrimSpace(stderr.String()), 300))
	}
	return cliResult(stdout.Bytes())
}

// cliEnvelope is the subset of `claude --output-format json` we care about.
type cliEnvelope struct {
	Type    string `json:"type"`
	Subtype string `json:"subtype"`
	IsError bool   `json:"is_error"`
	Result  string `json:"result"`
}

func cliResult(out []byte) (string, error) {
	var env cliEnvelope
	if err := json.Unmarshal(out, &env); err != nil {
		return "", fmt.Errorf("claude cli returned unexpected output: %s", truncate(strings.TrimSpace(string(out)), 300))
	}
	if env.IsError {
		return "", fmt.Errorf("claude cli error (%s): %s", env.Subtype, truncate(env.Result, 300))
	}
	if strings.TrimSpace(env.Result) == "" {
		return "", fmt.Errorf("claude cli returned an empty result")
	}
	return env.Result, nil
}

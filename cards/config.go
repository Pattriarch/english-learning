package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	AnthropicAPIKey   string `json:"anthropic_api_key"`
	UnsplashAccessKey string `json:"unsplash_access_key"`
	InboxDir          string `json:"inbox_dir"`
	DataDir           string `json:"data_dir"`
	Deck              string `json:"deck"`
	Model             string `json:"model"`
	JournalPort       int    `json:"journal_port"`
	AnkiConnectURL    string `json:"ankiconnect_url"`
}

func defaultConfig() Config {
	home, _ := os.UserHomeDir()
	base := filepath.Join(home, "Desktop", "english", "cards")
	return Config{
		InboxDir:       filepath.Join(base, "inbox"),
		DataDir:        filepath.Join(base, "data"),
		Deck:           "English",
		Model:          "claude-opus-5",
		JournalPort:    8787,
		AnkiConnectURL: "http://127.0.0.1:8765",
	}
}

// expandHome turns "~/x" into an absolute path.
func expandHome(p string) string {
	if strings.HasPrefix(p, "~/") {
		home, err := os.UserHomeDir()
		if err == nil {
			return filepath.Join(home, p[2:])
		}
	}
	return p
}

func loadConfig() (Config, error) {
	cfg := defaultConfig()
	path := "config.json"
	if _, err := os.Stat(path); err != nil {
		if exe, err := os.Executable(); err == nil {
			path = filepath.Join(filepath.Dir(exe), "config.json")
		}
	}
	if b, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(b, &cfg); err != nil {
			return cfg, errors.New(path + ": " + err.Error())
		}
	}
	if cfg.AnthropicAPIKey == "" {
		cfg.AnthropicAPIKey = os.Getenv("ANTHROPIC_API_KEY")
	}
	if cfg.UnsplashAccessKey == "" {
		cfg.UnsplashAccessKey = os.Getenv("UNSPLASH_ACCESS_KEY")
	}
	cfg.InboxDir = expandHome(cfg.InboxDir)
	cfg.DataDir = expandHome(cfg.DataDir)
	if cfg.AnthropicAPIKey == "" {
		return cfg, errors.New("anthropic_api_key не задан: заполни config.json или переменную окружения ANTHROPIC_API_KEY")
	}
	return cfg, nil
}

func (c Config) processedDir() string { return filepath.Join(c.InboxDir, "processed") }
func (c Config) failedDir() string    { return filepath.Join(c.InboxDir, "failed") }
func (c Config) mediaDir() string     { return filepath.Join(c.DataDir, "media") }
func (c Config) journalPath() string  { return filepath.Join(c.DataDir, "journal.json") }

func ensureDirs(c Config) error {
	for _, d := range []string{c.InboxDir, c.processedDir(), c.failedDir(), c.mediaDir()} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return err
		}
	}
	return nil
}

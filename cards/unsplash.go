package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	unsplashBaseURL  = "https://api.unsplash.com"
	unsplashTimeout  = 20 * time.Second
	unsplashMaxBytes = 5 << 20
)

type unsplashClient struct {
	key     string
	baseURL string
	http    *http.Client
}

func newUnsplashClient(cfg Config) *unsplashClient {
	return &unsplashClient{
		key:     strings.TrimSpace(cfg.UnsplashAccessKey),
		baseURL: unsplashBaseURL,
		http:    &http.Client{Timeout: unsplashTimeout},
	}
}

type unsplashSearchResponse struct {
	Results []struct {
		URLs struct {
			Small string `json:"small"`
		} `json:"urls"`
	} `json:"results"`
}

func (c *unsplashClient) Find(query string) ([]byte, string, error) {
	query = strings.TrimSpace(query)
	if c.key == "" {
		return nil, "", fmt.Errorf("unsplash_access_key не задан: %w", errNoImage)
	}
	if query == "" {
		return nil, "", fmt.Errorf("пустой запрос: %w", errNoImage)
	}

	endpoint := strings.TrimSuffix(c.baseURL, "/") +
		"/search/photos?query=" + url.QueryEscape(query) + "&per_page=1&orientation=landscape"

	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, "", fmt.Errorf("unsplash: %v: %w", err, errNoImage)
	}
	req.Header.Set("Authorization", "Client-ID "+c.key)

	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("unsplash: %v: %w", err, errNoImage)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("unsplash вернул %d: %w", resp.StatusCode, errNoImage)
	}

	var sr unsplashSearchResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, unsplashMaxBytes)).Decode(&sr); err != nil {
		return nil, "", fmt.Errorf("unsplash: не разобрать ответ: %v: %w", err, errNoImage)
	}
	if len(sr.Results) == 0 || strings.TrimSpace(sr.Results[0].URLs.Small) == "" {
		return nil, "", fmt.Errorf("unsplash: ничего не найдено по %q: %w", query, errNoImage)
	}

	data, err := c.download(sr.Results[0].URLs.Small)
	if err != nil {
		return nil, "", err
	}
	return data, ".jpg", nil
}

func (c *unsplashClient) download(link string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, link, nil)
	if err != nil {
		return nil, fmt.Errorf("unsplash: %v: %w", err, errNoImage)
	}
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("unsplash: скачивание не удалось: %v: %w", err, errNoImage)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unsplash: скачивание вернуло %d: %w", resp.StatusCode, errNoImage)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, unsplashMaxBytes))
	if err != nil {
		return nil, fmt.Errorf("unsplash: скачивание не удалось: %v: %w", err, errNoImage)
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("unsplash: пустая картинка: %w", errNoImage)
	}
	return data, nil
}

func (c *unsplashClient) httpClient() *http.Client {
	if c.http == nil {
		return &http.Client{Timeout: unsplashTimeout}
	}
	return c.http
}

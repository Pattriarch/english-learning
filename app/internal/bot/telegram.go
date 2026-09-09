package bot

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"time"
)

const pollTimeout = 50

type tgClient struct {
	token string
	http  *http.Client
}

func newTGClient(token string) *tgClient {
	return &tgClient{token: token, http: &http.Client{Timeout: (pollTimeout + 15) * time.Second}}
}

func (c *tgClient) url(method string) string {
	return "https://api.telegram.org/bot" + c.token + "/" + method
}

type apiResponse struct {
	OK          bool            `json:"ok"`
	Result      json.RawMessage `json:"result"`
	Description string          `json:"description"`
}

type Update struct {
	UpdateID int64 `json:"update_id"`
	Message  *struct {
		MessageID int64  `json:"message_id"`
		Text      string `json:"text"`
		Chat      struct {
			ID int64 `json:"id"`
		} `json:"chat"`
		From struct {
			ID        int64  `json:"id"`
			FirstName string `json:"first_name"`
		} `json:"from"`
	} `json:"message"`
}

func (c *tgClient) call(ctx context.Context, method string, params url.Values, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url(method), bytes.NewBufferString(params.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/x-www-form-urlencoded")
	return c.do(req, out)
}

func (c *tgClient) do(req *http.Request, out any) error {
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return err
	}
	var parsed apiResponse
	if err := json.Unmarshal(data, &parsed); err != nil {
		return fmt.Errorf("telegram %s: %d %s", req.URL.Path, resp.StatusCode, string(data))
	}
	if !parsed.OK {
		return fmt.Errorf("telegram: %s", parsed.Description)
	}
	if out != nil {
		return json.Unmarshal(parsed.Result, out)
	}
	return nil
}

func (c *tgClient) getUpdates(ctx context.Context, offset int64) ([]Update, error) {
	params := url.Values{
		"timeout":         {fmt.Sprint(pollTimeout)},
		"allowed_updates": {`["message"]`},
	}
	if offset > 0 {
		params.Set("offset", fmt.Sprint(offset))
	}
	var updates []Update
	if err := c.call(ctx, "getUpdates", params, &updates); err != nil {
		return nil, err
	}
	return updates, nil
}

func (c *tgClient) sendHTML(ctx context.Context, chatID int64, text string) error {
	for _, chunk := range splitMessage(text, maxMessageLen) {
		params := url.Values{
			"chat_id":                  {fmt.Sprint(chatID)},
			"text":                     {chunk},
			"parse_mode":               {"HTML"},
			"disable_web_page_preview": {"true"},
		}
		if err := c.call(ctx, "sendMessage", params, nil); err != nil {
			return err
		}
	}
	return nil
}

func (c *tgClient) sendDocument(ctx context.Context, chatID int64, filename, caption string, body []byte) error {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("chat_id", fmt.Sprint(chatID))
	if caption != "" {
		_ = mw.WriteField("caption", caption)
	}
	part, err := mw.CreateFormFile("document", filename)
	if err != nil {
		return err
	}
	if _, err := part.Write(body); err != nil {
		return err
	}
	if err := mw.Close(); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url("sendDocument"), &buf)
	if err != nil {
		return err
	}
	req.Header.Set("content-type", mw.FormDataContentType())
	return c.do(req, nil)
}

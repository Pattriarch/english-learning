package studio

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

func validMedia(name string) bool {
	return name == "" || (len(name) == 68 && strings.HasSuffix(name, ".png") && isHex(name[:64])) || (len(name) == 68 && strings.HasSuffix(name, ".jpg") && isHex(name[:64]))
}
func isHex(s string) bool { _, e := hex.DecodeString(s); return e == nil }
func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 12<<20)
	if e := r.ParseMultipartForm(12 << 20); e != nil {
		problem(w, 400, errors.New("Изображение должно быть меньше 12 МБ"))
		return
	}
	defer r.MultipartForm.RemoveAll()
	f, _, e := r.FormFile("file")
	if e != nil {
		problem(w, 400, e)
		return
	}
	defer f.Close()
	b, e := io.ReadAll(f)
	if e != nil {
		problem(w, 400, e)
		return
	}
	ext := ""
	switch http.DetectContentType(b) {
	case "image/png":
		ext = ".png"
	case "image/jpeg":
		ext = ".jpg"
	default:
		problem(w, 400, errors.New("Поддерживаются PNG и JPEG"))
		return
	}
	h := sha256.Sum256(b)
	name := hex.EncodeToString(h[:]) + ext
	if e = os.WriteFile(filepath.Join(s.db.dir, "media", name), b, 0600); e != nil {
		problem(w, 500, e)
		return
	}
	jsonResponse(w, 200, map[string]string{"image": name})
}
func (s *Server) ocr(w http.ResponseWriter, r *http.Request) {
	var b struct{ Image string }
	if !decode(w, r, &b) {
		return
	}
	if b.Image == "" || !validMedia(b.Image) {
		problem(w, 400, errors.New("Некорректное изображение"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	p, e := filepath.Abs(filepath.Join(s.db.dir, "media", b.Image))
	if e != nil {
		problem(w, 500, e)
		return
	}
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		script, _ := filepath.Abs(filepath.Join(s.content, "..", "scripts", "ocr.ps1"))
		cmd = exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-ImagePath", p)
	} else {
		cmd = exec.CommandContext(ctx, "tesseract", p, "stdout", "-l", "eng")
	}
	var out, errout bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errout
	if e = cmd.Run(); e != nil {
		problem(w, 422, errors.New("OCR недоступен: в Windows нужен установленный английский языковой пакет с OCR; на macOS/Linux — tesseract. Фразу можно вставить вручную. "+clip(errout.String(), 140)))
		return
	}
	text := strings.TrimSpace(strings.TrimPrefix(out.String(), "\ufeff"))
	if text == "" {
		problem(w, 422, errors.New("Текст не найден. Обрежьте скриншот ближе к субтитрам"))
		return
	}
	jsonResponse(w, 200, map[string]string{"text": text})
}
func (s *Server) addCard(w http.ResponseWriter, r *http.Request) {
	var c Card
	if !decode(w, r, &c) {
		return
	}
	c.Front = strings.TrimSpace(c.Front)
	c.Back = strings.TrimSpace(c.Back)
	if !safeID.MatchString(c.ID) || c.Front == "" || c.Back == "" || len(c.Front) > 5000 || len(c.Back) > 5000 || len(c.Note) > 10000 || !validMedia(c.Image) {
		problem(w, 400, errors.New("Нужны русский смысл и английская фраза"))
		return
	}
	c.Created = stamp()
	c.Due = stamp()
	c.Ease = 2.5
	c.Interval = 0
	c.Repetitions = 0
	c.Lapses = 0
	c.AnkiID = 0
	e := s.db.change(func(p *Progress) error {
		for _, old := range p.Cards {
			if old.ID == c.ID {
				c = old
				return nil
			}
		}
		p.Cards = append(p.Cards, c)
		return nil
	})
	if e != nil {
		problem(w, 500, e)
		return
	}
	jsonResponse(w, 200, c)
}
func (s *Server) deleteCard(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	e := s.db.change(func(p *Progress) error {
		for i, c := range p.Cards {
			if c.ID == id {
				p.Cards = append(p.Cards[:i], p.Cards[i+1:]...)
				return nil
			}
		}
		return errors.New("Карточка не найдена")
	})
	s.saved(w, e)
}
func (s *Server) review(w http.ResponseWriter, r *http.Request) {
	var v Review
	if !decode(w, r, &v) {
		return
	}
	if !safeID.MatchString(v.ID) || v.Rating < 0 || v.Rating > 3 || len(v.Answer) > 10000 {
		problem(w, 400, errors.New("Некорректная оценка"))
		return
	}
	v.At = stamp()
	e := s.db.change(func(p *Progress) error {
		for _, old := range p.Reviews {
			if old.ID == v.ID {
				return nil
			}
		}
		for i := range p.Cards {
			if p.Cards[i].ID == v.CardID {
				schedule(&p.Cards[i], v.Rating, time.Now())
				p.Reviews = append(p.Reviews, v)
				return nil
			}
		}
		return errors.New("Карточка не найдена")
	})
	s.saved(w, e)
}
func (s *Server) transcribe(w http.ResponseWriter, r *http.Request) {
	c := s.db.config()
	if c.WhisperURL == "" {
		problem(w, 400, errors.New("Укажите адрес whisper.cpp в настройках или используйте распознавание браузера"))
		return
	}
	u, e := endpoint(c.WhisperURL)
	if e != nil {
		problem(w, 400, e)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 22<<20)
	if e = r.ParseMultipartForm(22 << 20); e != nil {
		problem(w, 400, e)
		return
	}
	defer r.MultipartForm.RemoveAll()
	f, _, e := r.FormFile("file")
	if e != nil {
		problem(w, 400, e)
		return
	}
	defer f.Close()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, _ := mw.CreateFormFile("file", "speech.wav")
	_, _ = io.Copy(part, f)
	_ = mw.WriteField("language", "en")
	_ = mw.WriteField("response_format", "json")
	_ = mw.Close()
	req, e := http.NewRequestWithContext(r.Context(), "POST", u.String(), &buf)
	if e != nil {
		problem(w, 400, e)
		return
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, e := (&http.Client{Timeout: 2 * time.Minute}).Do(req)
	if e != nil {
		problem(w, 502, errors.New("Сервер whisper.cpp недоступен"))
		return
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		problem(w, 502, serviceError("whisper.cpp", res.StatusCode))
		return
	}
	b, _ := boundedRead(res.Body)
	var v struct {
		Text string `json:"text"`
	}
	if json.Unmarshal(b, &v) != nil || strings.TrimSpace(v.Text) == "" {
		problem(w, 422, errors.New("Речь не распознана. Попробуйте говорить ближе к микрофону"))
		return
	}
	jsonResponse(w, 200, v)
}
func cardHTML(c Card) (string, string) {
	front := html.EscapeString(c.Front)
	back := html.EscapeString(c.Back) + "<br><br>" + strings.ReplaceAll(html.EscapeString(c.Note), "\n", "<br>")
	if c.Image != "" {
		back += `<br><img src="` + c.Image + `">`
	}
	if c.Source != "" {
		back += "<br><small>" + html.EscapeString(c.Source) + "</small>"
	}
	return front, back
}
func (s *Server) exportAnki(w http.ResponseWriter, r *http.Request) {
	p := s.db.snapshot()
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	f, _ := z.Create("english.tsv")
	_, _ = io.WriteString(f, "#separator:Tab\n#html:true\n#notetype:Basic\n#columns:Front\tBack\n")
	for _, c := range p.Cards {
		front, back := cardHTML(c)
		clean := func(v string) string { return strings.NewReplacer("\t", " ", "\r", " ", "\n", "<br>").Replace(v) }
		_, _ = fmt.Fprintf(f, "%s\t%s\n", clean(front), clean(back))
	}
	seen := map[string]bool{}
	missing := []string{}
	for _, c := range p.Cards {
		if c.Image == "" || seen[c.Image] {
			continue
		}
		seen[c.Image] = true
		b, e := os.ReadFile(filepath.Join(s.db.dir, "media", c.Image))
		if e != nil {
			missing = append(missing, c.Image)
			continue
		}
		f, _ := z.Create("collection.media/" + c.Image)
		_, _ = f.Write(b)
	}
	f, _ = z.Create("README.txt")
	_, _ = io.WriteString(f, "Anki: copy files from collection.media into your Anki profile's collection.media directory. Import english.tsv into a Basic note type (Front -> Front, Back -> Back), with HTML enabled. Russian is the prompt; English and the scene are the answer. JSON progress export does not include images; keep this archive or the app/data/studio/media folder too.\nMissing images: "+strings.Join(missing, ", "))
	if e := z.Close(); e != nil {
		problem(w, 500, e)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="english-anki.zip"`)
	_, _ = w.Write(buf.Bytes())
}
func ankiCall(ctx context.Context, action string, params any) (json.RawMessage, error) {
	b, _ := json.Marshal(map[string]any{"action": action, "version": 6, "params": params})
	req, _ := http.NewRequestWithContext(ctx, "POST", "http://127.0.0.1:8765", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	res, e := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if e != nil {
		return nil, errors.New("Откройте Anki с дополнением AnkiConnect (2055492159)")
	}
	defer res.Body.Close()
	var out struct {
		Result json.RawMessage `json:"result"`
		Error  *string         `json:"error"`
	}
	if e = json.NewDecoder(res.Body).Decode(&out); e != nil {
		return nil, e
	}
	if out.Error != nil {
		return nil, errors.New(*out.Error)
	}
	return out.Result, nil
}
func (s *Server) syncAnki(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	deck := s.db.config().Deck
	if deck == "" {
		deck = "English Workshop"
	}
	if _, e := ankiCall(ctx, "createDeck", map[string]string{"deck": deck}); e != nil {
		problem(w, 502, e)
		return
	}
	model := "English Workshop"
	_, e := ankiCall(ctx, "modelNames", nil)
	if e != nil {
		problem(w, 502, e)
		return
	}
	// Dedicated model also works with localized Anki installations.
	_, e = ankiCall(ctx, "createModel", map[string]any{"modelName": model, "inOrderFields": []string{"Front", "Back"}, "css": ".card{font-family:Arial;font-size:24px;text-align:center;color:#223;background:#fafafa} img{max-height:320px;max-width:100%}", "cardTemplates": []map[string]string{{"Name": "Recall", "Front": "{{Front}}", "Back": "{{FrontSide}}<hr id=answer>{{Back}}"}}})
	if e != nil && !strings.Contains(strings.ToLower(e.Error()), "exist") {
		problem(w, 502, e)
		return
	}
	count := 0
	for _, c := range s.db.snapshot().Cards {
		if c.AnkiID != 0 {
			continue
		}
		tag := "ew_" + c.ID
		found, e := ankiCall(ctx, "findNotes", map[string]string{"query": "tag:" + tag})
		if e != nil {
			problem(w, 502, e)
			return
		}
		var ids []int64
		_ = json.Unmarshal(found, &ids)
		var noteID int64
		if len(ids) > 0 {
			noteID = ids[0]
		} else {
			if c.Image != "" {
				b, e := os.ReadFile(filepath.Join(s.db.dir, "media", c.Image))
				if e != nil {
					problem(w, 422, errors.New("Отсутствует картинка карточки: "+c.Image))
					return
				}
				if _, e = ankiCall(ctx, "storeMediaFile", map[string]string{"filename": c.Image, "data": base64.StdEncoding.EncodeToString(b)}); e != nil {
					problem(w, 502, e)
					return
				}
			}
			front, back := cardHTML(c)
			v, e := ankiCall(ctx, "addNote", map[string]any{"note": map[string]any{"deckName": deck, "modelName": model, "fields": map[string]string{"Front": front, "Back": back}, "options": map[string]bool{"allowDuplicate": true}, "tags": []string{"english_workshop", tag}}})
			if e != nil {
				problem(w, 502, e)
				return
			}
			if e = json.Unmarshal(v, &noteID); e != nil || noteID == 0 {
				problem(w, 502, errors.New("Anki не вернул номер карточки"))
				return
			}
		}
		e = s.db.change(func(p *Progress) error {
			for i := range p.Cards {
				if p.Cards[i].ID == c.ID {
					p.Cards[i].AnkiID = noteID
				}
			}
			return nil
		})
		if e != nil {
			problem(w, 500, e)
			return
		}
		count++
	}
	jsonResponse(w, 200, map[string]int{"added": count})
}

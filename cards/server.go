package main

import (
	"html/template"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type server struct {
	cfg  Config
	j    *journal
	anki AnkiClient
	p    *pipeline
	tmpl *template.Template
}

func newServer(cfg Config, j *journal, anki AnkiClient, p *pipeline) *server {
	return &server{
		cfg:  cfg,
		j:    j,
		anki: anki,
		p:    p,
		tmpl: template.Must(template.New("journal").Funcs(template.FuncMap{
			"ts": func(e Entry) string { return e.CreatedAt.Format("02.01 15:04") },
		}).Parse(journalHTML)),
	}
}

func (s *server) routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleIndex)
	mux.HandleFunc("/media/", s.handleMedia)
	mux.HandleFunc("/delete", s.handleDelete)
	mux.HandleFunc("/retry", s.handleRetry)
	return mux
}

func (s *server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	entries := s.j.All()
	sort.Slice(entries, func(i, k int) bool { return entries[i].CreatedAt.After(entries[k].CreatedAt) })
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := s.tmpl.Execute(w, entries); err != nil {
		log.Printf("шаблон журнала: %v", err)
	}
}

func (s *server) handleMedia(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/media/")
	if name == "" || name == "." || name == ".." ||
		strings.ContainsAny(name, `/\`) || strings.Contains(name, "..") {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, filepath.Join(s.cfg.mediaDir(), name))
}

func (s *server) handleDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "только POST", http.StatusMethodNotAllowed)
		return
	}
	e, ok := s.j.Get(r.URL.Query().Get("id"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	if e.NoteID != 0 {
		if err := s.anki.DeleteNote(e.NoteID); err != nil {
			log.Printf("не могу удалить заметку %d: %v", e.NoteID, err)
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
	}
	if err := s.j.Update(e.ID, func(en *Entry) {
		en.Status = StatusDeleted
		en.Error = ""
	}); err != nil {
		log.Printf("журнал: %v", err)
	}
	log.Printf("карточка удалена: %s", e.Phrase)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (s *server) handleRetry(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "только POST", http.StatusMethodNotAllowed)
		return
	}
	e, ok := s.j.Get(r.URL.Query().Get("id"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	// Фраза уже распознана — падение было на стороне Anki. Гонять картинку
	// через Claude второй раз незачем, повторяем только доставку.
	if e.Phrase != "" {
		if err := s.j.Update(e.ID, func(en *Entry) {
			en.Status = StatusPending
			en.Attempts = 0
			en.Error = ""
		}); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		e.Attempts = 0
		go s.p.deliver(e)
		log.Printf("повторная отправка в Anki: %s", e.Phrase)
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}

	src := filepath.Join(s.cfg.failedDir(), e.Screenshot)
	if _, err := os.Stat(src); err != nil {
		http.Error(w, "скриншот не найден: "+e.Screenshot, http.StatusNotFound)
		return
	}
	// Кладём скрин обратно в inbox — дальше его подхватит обычный путь.
	if _, err := moveFile(src, s.cfg.InboxDir); err != nil {
		log.Printf("не могу вернуть %s в inbox: %v", e.Screenshot, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	log.Printf("переобработка: %s", e.Screenshot)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

const journalHTML = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>English — журнал</title>
<style>
:root{--bg:#151515;--card:#1e1e1e;--line:#2e2e2e;--fg:#e6e4e0;--dim:#8d8a85;--faint:#5f5c58}
*{box-sizing:border-box}
body{margin:0;padding:32px 20px 64px;background:var(--bg);color:var(--fg);
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
main{max-width:820px;margin:0 auto}
h1{font-size:15px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
  color:var(--dim);margin:0 0 24px}
.card{display:flex;gap:16px;background:var(--card);border:1px solid var(--line);
  border-radius:8px;padding:14px 16px;margin-bottom:12px}
.thumb{width:96px;height:96px;flex:0 0 96px;object-fit:cover;border-radius:6px;
  background:#000;filter:saturate(.85)}
.body{flex:1;min-width:0}
.phrase{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;
  word-break:break-word;margin-bottom:2px}
.ru{color:var(--dim);margin-bottom:8px}
.ex{font-size:13px;color:var(--dim);font-style:italic}
.ex-ru{font-size:13px;color:var(--faint);font-style:italic;margin-bottom:8px}
.err{font-size:13px;color:#b98b8b;margin-top:6px}
.meta{display:flex;align-items:center;gap:10px;margin-top:10px;
  font-size:12px;color:var(--faint)}
.badge{font-size:11px;letter-spacing:.06em;text-transform:uppercase;
  padding:2px 7px;border-radius:4px;border:1px solid currentColor}
.created{color:#7e9c7a}.pending{color:#a89463}.failed{color:#b07c7c}
.duplicate{color:#7b8ea3}.deleted{color:var(--faint)}
form{display:inline;margin:0}
button{font:inherit;font-size:12px;color:var(--dim);background:transparent;
  border:1px solid var(--line);border-radius:4px;padding:2px 9px;cursor:pointer}
button:hover{color:var(--fg);border-color:var(--faint)}
.empty{color:var(--faint);padding:40px 0}
</style></head><body><main>
<h1>English — журнал</h1>
{{if not .}}<p class="empty">Пусто. Брось скриншот в inbox/.</p>{{end}}
{{range .}}
<div class="card">
  {{if .MediaFile}}<img class="thumb" src="/media/{{.MediaFile}}" alt="">{{end}}
  <div class="body">
    <div class="phrase">{{if .Phrase}}{{.Phrase}}{{else}}—{{end}}</div>
    <div class="ru">{{.TranslationRU}}</div>
    {{if .ExampleEN}}<div class="ex">{{.ExampleEN}}</div>{{end}}
    {{if .ExampleRU}}<div class="ex-ru">{{.ExampleRU}}</div>{{end}}
    {{if .Error}}<div class="err">{{.Error}}</div>{{end}}
    <div class="meta">
      <span class="badge {{.Status}}">{{.Status}}</span>
      <span>{{ts .}}</span>
      <span>{{.Screenshot}}</span>
      {{if eq .Status "created"}}
        <form method="post" action="/delete?id={{.ID}}"><button>удалить</button></form>
      {{end}}
      {{if eq .Status "failed"}}
        <form method="post" action="/retry?id={{.ID}}"><button>переобработать</button></form>
      {{end}}
    </div>
  </div>
</div>
{{end}}
</main></body></html>`

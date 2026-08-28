package main

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Попытки достучаться до Anki идут раз в минуту, то есть это неделя ожидания.
// Закрытый на пару дней Anki — обычное дело, и запись должна его дождаться.
const maxAnkiAttempts = 7 * 24 * 60

type pipeline struct {
	cfg       Config
	extractor Extractor
	finder    ImageFinder
	anki      AnkiClient
	journal   *journal
}

func newPipeline(cfg Config, extractor Extractor, finder ImageFinder, anki AnkiClient, j *journal) *pipeline {
	return &pipeline{cfg: cfg, extractor: extractor, finder: finder, anki: anki, journal: j}
}

// Process проводит один скриншот через весь конвейер.
func (p *pipeline) Process(screenshotPath string) {
	e := Entry{
		ID:         newEntryID(),
		CreatedAt:  time.Now(),
		Screenshot: filepath.Base(screenshotPath),
		Attempts:   1,
	}

	ex, err := p.extractor.Extract(screenshotPath)
	if err != nil {
		if name, mErr := moveFile(screenshotPath, p.cfg.failedDir()); mErr != nil {
			log.Printf("не могу перенести %s в failed: %v", e.Screenshot, mErr)
		} else {
			e.Screenshot = name
		}
		e.Status = StatusFailed
		e.Error = err.Error()
		p.record(e)
		log.Printf("не распознано (%s): %v", e.Screenshot, err)
		return
	}
	e.Extraction = ex
	log.Printf("фраза: %s — %s", ex.Phrase, ex.TranslationRU)

	if data, ext, err := p.finder.Find(ex.ImageQuery); err != nil {
		log.Printf("без картинки: %v", err)
	} else {
		if ext == "" {
			ext = ".jpg"
		}
		name := "englishd-" + e.ID + ext
		if err := os.WriteFile(filepath.Join(p.cfg.mediaDir(), name), data, 0o644); err != nil {
			log.Printf("не могу сохранить картинку: %v", err)
		} else {
			e.MediaFile = name
		}
	}

	// Скрин уезжает из inbox до похода в Anki: если Anki лежит, файл не должен
	// попасть в обработку второй раз.
	if name, err := moveFile(screenshotPath, p.cfg.processedDir()); err != nil {
		log.Printf("не могу перенести %s в processed: %v", e.Screenshot, err)
	} else {
		e.Screenshot = name
	}

	e.Status = StatusPending
	p.record(e)

	if err := p.deliver(e); err != nil && errors.Is(err, errAnkiUnreachable) {
		log.Printf("Anki недоступен, отложено: %s", e.Phrase)
	}
}

// deliver — половина конвейера, отвечающая за Anki. Безопасна к повторному
// запуску на pending-записи: её же крутит RetryPending.
func (p *pipeline) deliver(e Entry) error {
	err := p.anki.EnsureDeck(p.cfg.Deck)

	media := ""
	if err == nil && e.MediaFile != "" {
		data, readErr := os.ReadFile(filepath.Join(p.cfg.mediaDir(), e.MediaFile))
		if readErr != nil {
			log.Printf("картинка %s пропала, карточка будет без неё: %v", e.MediaFile, readErr)
		} else {
			media, err = p.anki.StoreMedia(e.MediaFile, data)
		}
	}

	var noteID int64
	if err == nil {
		noteID, err = p.anki.AddNote(p.cfg.Deck, e.Extraction, media)
	}

	switch {
	case err == nil:
		p.update(e.ID, func(en *Entry) {
			en.Status = StatusCreated
			en.NoteID = noteID
			en.Error = ""
		})
		log.Printf("карточка создана: %s", e.Phrase)
		return nil

	case errors.Is(err, errDuplicate):
		p.update(e.ID, func(en *Entry) {
			en.Status = StatusDuplicate
			en.Error = ""
		})
		log.Printf("дубликат, пропускаю: %s", e.Phrase)
		return nil

	case errors.Is(err, errAnkiUnreachable):
		p.update(e.ID, func(en *Entry) {
			en.Status = StatusPending
			en.Attempts++
			en.Error = err.Error()
		})
		return err

	default:
		p.update(e.ID, func(en *Entry) {
			en.Status = StatusFailed
			en.Error = err.Error()
		})
		log.Printf("Anki отказал: %v", err)
		return err
	}
}

// RetryPending дожимает записи, застрявшие в pending (обычно Anki был закрыт).
func (p *pipeline) RetryPending() {
	for _, e := range p.journal.Pending() {
		if e.Attempts >= maxAnkiAttempts {
			p.update(e.ID, func(en *Entry) {
				en.Status = StatusFailed
				en.Error = "Anki недоступен слишком долго"
			})
			log.Printf("сдаюсь: %s — Anki недоступен слишком долго", e.Phrase)
			continue
		}
		p.deliver(e)
	}
}

func (p *pipeline) record(e Entry) {
	if err := p.journal.Add(e); err != nil {
		log.Printf("журнал: не могу записать %s: %v", e.ID, err)
	}
}

func (p *pipeline) update(id string, mutate func(*Entry)) {
	if err := p.journal.Update(id, mutate); err != nil {
		log.Printf("журнал: не могу обновить %s: %v", id, err)
	}
}

// moveFile переносит файл в dstDir и возвращает итоговое имя. Ничего не
// перезаписывает: занятое имя получает суффикс -1, -2, ...
func moveFile(src, dstDir string) (string, error) {
	if err := os.MkdirAll(dstDir, 0o755); err != nil {
		return "", err
	}
	name := uniqueName(dstDir, filepath.Base(src))
	dst := filepath.Join(dstDir, name)

	if err := os.Rename(src, dst); err == nil {
		return name, nil
	}
	// Rename не работает между разными томами — копируем и удаляем.
	if err := copyFile(src, dst); err != nil {
		return "", err
	}
	if err := os.Remove(src); err != nil {
		return name, fmt.Errorf("скопировано, но исходник не удалён: %w", err)
	}
	return name, nil
}

func uniqueName(dir, base string) string {
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	name := base
	for i := 1; ; i++ {
		if _, err := os.Lstat(filepath.Join(dir, name)); errors.Is(err, fs.ErrNotExist) {
			return name
		}
		name = fmt.Sprintf("%s-%d%s", stem, i, ext)
	}
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(dst)
		return err
	}
	return out.Close()
}

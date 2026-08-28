package main

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

var imageExts = map[string]bool{
	".png":  true,
	".jpg":  true,
	".jpeg": true,
	".webp": true,
	".gif":  true,
}

func isScreenshot(name string) bool {
	if name == "" || strings.HasPrefix(name, ".") {
		return false
	}
	return imageExts[strings.ToLower(filepath.Ext(name))]
}

// scanExisting подбирает скрины, упавшие в inbox, пока демон лежал.
func scanExisting(dir string, onFile func(string)) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		log.Printf("не могу прочитать %s: %v", dir, err)
		return
	}
	for _, ent := range entries {
		if ent.IsDir() || !isScreenshot(ent.Name()) {
			continue
		}
		onFile(filepath.Join(dir, ent.Name()))
	}
}

// watch следит только за dir, без подкаталогов: processed/ и failed/ лежат
// внутри и повторно обрабатываться не должны.
func watch(ctx context.Context, dir string, onFile func(string)) error {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	defer w.Close()
	if err := w.Add(dir); err != nil {
		return err
	}

	d := &settler{inflight: make(map[string]bool), onFile: onFile}
	defer d.wg.Wait()

	for {
		select {
		case <-ctx.Done():
			return nil

		case ev, ok := <-w.Events:
			if !ok {
				return nil
			}
			if ev.Op&(fsnotify.Create|fsnotify.Write) == 0 {
				continue
			}
			if !isScreenshot(filepath.Base(ev.Name)) {
				continue
			}
			if fi, err := os.Stat(ev.Name); err != nil || fi.IsDir() {
				continue
			}
			d.trigger(ctx, ev.Name)

		case err, ok := <-w.Errors:
			if !ok {
				return nil
			}
			log.Printf("вотчер: %v", err)
		}
	}
}

// settler гасит пачку событий, которую macOS шлёт на один скриншот, и ждёт,
// пока файл дозапишется.
type settler struct {
	mu       sync.Mutex
	inflight map[string]bool
	onFile   func(string)
	wg       sync.WaitGroup
}

func (s *settler) trigger(ctx context.Context, path string) {
	s.mu.Lock()
	if s.inflight[path] {
		s.mu.Unlock()
		return
	}
	s.inflight[path] = true
	s.mu.Unlock()

	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		stable := waitStable(ctx, path)
		if stable {
			s.onFile(path)
		}
		s.mu.Lock()
		delete(s.inflight, path)
		s.mu.Unlock()
	}()
}

const (
	settleInterval = 400 * time.Millisecond
	settleMaxTicks = 75 // ~30 с потолок на дозапись
)

// waitStable ждёт, пока размер файла совпадёт в двух замерах подряд: скриншот
// прилетает частями, и читать его на середине записи нельзя.
func waitStable(ctx context.Context, path string) bool {
	last := int64(-1)
	timer := time.NewTimer(settleInterval)
	defer timer.Stop()
	for i := 0; i < settleMaxTicks; i++ {
		select {
		case <-ctx.Done():
			return false
		case <-timer.C:
			timer.Reset(settleInterval)
		}
		fi, err := os.Stat(path)
		if err != nil {
			return false
		}
		size := fi.Size()
		if size > 0 && size == last {
			return true
		}
		last = size
	}
	return false
}

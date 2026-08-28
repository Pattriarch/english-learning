package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

func main() {
	log.SetFlags(log.Ldate | log.Ltime)

	cfg, err := loadConfig()
	if err != nil {
		fmt.Fprintln(os.Stderr, "ошибка конфигурации:", err)
		os.Exit(1)
	}
	if err := ensureDirs(cfg); err != nil {
		fmt.Fprintln(os.Stderr, "не могу создать каталоги:", err)
		os.Exit(1)
	}
	j, err := newJournal(cfg.journalPath())
	if err != nil {
		fmt.Fprintln(os.Stderr, "не могу открыть журнал:", err)
		os.Exit(1)
	}

	anki := newAnkiClient(cfg)
	p := newPipeline(cfg, newClaudeClient(cfg), newUnsplashClient(cfg), anki, j)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Только петля: журнал показывает содержимое карточек, наружу ему не надо.
	srv := &http.Server{
		Addr:    fmt.Sprintf("127.0.0.1:%d", cfg.JournalPort),
		Handler: newServer(cfg, j, anki, p).routes(),
	}
	go func() {
		log.Printf("журнал: http://localhost:%d", cfg.JournalPort)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("сервер журнала: %v", err)
		}
	}()

	// Один рабочий: скрины обрабатываются строго по одному — лимиты API и
	// порядок записей в журнале.
	queue := make(chan string, 256)
	var worker sync.WaitGroup
	worker.Add(1)
	go func() {
		defer worker.Done()
		for path := range queue {
			p.Process(path)
		}
	}()

	enqueue := func(path string) {
		log.Printf("получен скрин: %s", filepath.Base(path))
		select {
		case queue <- path:
		default:
			log.Printf("очередь переполнена, пропускаю %s", filepath.Base(path))
		}
	}

	log.Printf("слежу за %s", cfg.InboxDir)
	scanExisting(cfg.InboxDir, enqueue)

	go func() {
		t := time.NewTicker(60 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				p.RetryPending()
			}
		}
	}()

	watchDone := make(chan struct{})
	go func() {
		defer close(watchDone)
		if err := watch(ctx, cfg.InboxDir, enqueue); err != nil {
			log.Printf("вотчер остановлен: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("останавливаюсь")

	<-watchDone
	close(queue)
	worker.Wait()

	shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutCtx); err != nil {
		log.Printf("сервер журнала: %v", err)
	}
}

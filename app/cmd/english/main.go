package main

import (
	"flag"
	"log"
	"net/http"
	"time"

	"english/app/internal/studio"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8777", "listen address")
	data := flag.String("data", "data/studio", "progress directory")
	flag.Parse()
	s, err := studio.New(*data, "content", "studio")
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("English Workshop: http://%s", *addr)
	log.Printf("Progress: %s/progress.json", *data)
	srv := &http.Server{Addr: *addr, Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}
	log.Fatal(srv.ListenAndServe())
}

package main

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUnsplashFind(t *testing.T) {
	imageBody := []byte("\xff\xd8\xff fake jpeg bytes")

	tests := []struct {
		name     string
		key      string
		search   func(w http.ResponseWriter, r *http.Request, imageURL string)
		wantData []byte
		wantErr  error
	}{
		{
			name: "success",
			key:  "test-key",
			search: func(w http.ResponseWriter, r *http.Request, imageURL string) {
				if got := r.Header.Get("Authorization"); got != "Client-ID test-key" {
					t.Errorf("Authorization = %q", got)
				}
				q := r.URL.Query()
				if q.Get("query") != "burning wooden bridge" {
					t.Errorf("query = %q", q.Get("query"))
				}
				if q.Get("per_page") != "1" || q.Get("orientation") != "landscape" {
					t.Errorf("per_page=%q orientation=%q", q.Get("per_page"), q.Get("orientation"))
				}
				fmt.Fprintf(w, `{"results":[{"urls":{"small":%q}}]}`, imageURL)
			},
			wantData: imageBody,
		},
		{
			name: "empty results",
			key:  "test-key",
			search: func(w http.ResponseWriter, r *http.Request, imageURL string) {
				fmt.Fprint(w, `{"results":[]}`)
			},
			wantErr: errNoImage,
		},
		{
			name: "non-200",
			key:  "test-key",
			search: func(w http.ResponseWriter, r *http.Request, imageURL string) {
				http.Error(w, "rate limited", http.StatusTooManyRequests)
			},
			wantErr: errNoImage,
		},
		{
			name:    "empty key",
			key:     "",
			search:  func(w http.ResponseWriter, r *http.Request, imageURL string) { t.Error("search should not be called") },
			wantErr: errNoImage,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mux := http.NewServeMux()
			srv := httptest.NewServer(mux)
			defer srv.Close()

			mux.HandleFunc("/photo.jpg", func(w http.ResponseWriter, r *http.Request) {
				w.Write(imageBody)
			})
			mux.HandleFunc("/search/photos", func(w http.ResponseWriter, r *http.Request) {
				tt.search(w, r, srv.URL+"/photo.jpg")
			})

			c := newUnsplashClient(Config{UnsplashAccessKey: tt.key})
			c.baseURL = srv.URL

			data, ext, err := c.Find("burning wooden bridge")
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("err = %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if ext != ".jpg" {
				t.Errorf("ext = %q, want .jpg", ext)
			}
			if string(data) != string(tt.wantData) {
				t.Errorf("data = %q, want %q", data, tt.wantData)
			}
		})
	}
}

func TestUnsplashFindEmptyQuery(t *testing.T) {
	c := newUnsplashClient(Config{UnsplashAccessKey: "k"})
	c.baseURL = "http://127.0.0.1:1"
	if _, _, err := c.Find("   "); !errors.Is(err, errNoImage) {
		t.Fatalf("err = %v, want errNoImage", err)
	}
}

func TestParseExtraction(t *testing.T) {
	clean := `{"phrase":"burn bridges","translation_ru":"сжигать мосты","example_en":"He burned bridges with his old firm.","example_ru":"Он сжёг мосты со своей старой фирмой.","image_query":"burning wooden bridge"}`

	tests := []struct {
		name    string
		raw     string
		want    Extraction
		wantErr error
	}{
		{
			name: "clean json",
			raw:  clean,
			want: Extraction{
				Phrase:        "burn bridges",
				TranslationRU: "сжигать мосты",
				ExampleEN:     "He burned bridges with his old firm.",
				ExampleRU:     "Он сжёг мосты со своей старой фирмой.",
				ImageQuery:    "burning wooden bridge",
			},
		},
		{
			name: "fenced json",
			raw:  "```json\n" + clean + "\n```",
			want: Extraction{
				Phrase:        "burn bridges",
				TranslationRU: "сжигать мосты",
				ExampleEN:     "He burned bridges with his old firm.",
				ExampleRU:     "Он сжёг мосты со своей старой фирмой.",
				ImageQuery:    "burning wooden bridge",
			},
		},
		{
			name: "surrounding prose",
			raw:  "Sure! Here is the extraction:\n" + clean + "\nLet me know if you need more.",
			want: Extraction{
				Phrase:        "burn bridges",
				TranslationRU: "сжигать мосты",
				ExampleEN:     "He burned bridges with his old firm.",
				ExampleRU:     "Он сжёг мосты со своей старой фирмой.",
				ImageQuery:    "burning wooden bridge",
			},
		},
		{
			name: "whitespace trimmed",
			raw:  `{"phrase":"  hit the sack \n","translation_ru":" завалиться спать ","example_en":" I hit the sack early. ","example_ru":" Я рано завалился спать. ","image_query":" person sleeping bed "}`,
			want: Extraction{
				Phrase:        "hit the sack",
				TranslationRU: "завалиться спать",
				ExampleEN:     "I hit the sack early.",
				ExampleRU:     "Я рано завалился спать.",
				ImageQuery:    "person sleeping bed",
			},
		},
		{
			name:    "empty phrase",
			raw:     `{"phrase":"","translation_ru":"","example_en":"","example_ru":"","image_query":""}`,
			wantErr: errNoPhrase,
		},
		{
			name:    "blank phrase",
			raw:     `{"phrase":"   ","translation_ru":"x","example_en":"x","example_ru":"x","image_query":"x"}`,
			wantErr: errNoPhrase,
		},
		{
			name:    "empty response",
			raw:     "   ",
			wantErr: errNoPhrase,
		},
		{
			name:    "garbage",
			raw:     "{not json at all}",
			wantErr: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseExtraction(tt.raw)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("err = %v, want %v", err, tt.wantErr)
				}
				return
			}
			if tt.name == "garbage" {
				if err == nil {
					t.Fatal("want an error for unparseable input")
				}
				if errors.Is(err, errNoPhrase) {
					t.Fatal("garbage must not be reported as errNoPhrase")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got != tt.want {
				t.Errorf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestDetectMediaType(t *testing.T) {
	tests := []struct {
		name    string
		path    string
		data    []byte
		want    string
		wantErr bool
	}{
		{name: "png magic", path: "x.bin", data: []byte("\x89PNG\r\n\x1a\n rest"), want: "image/png"},
		{name: "jpeg magic", path: "x.bin", data: []byte{0xFF, 0xD8, 0xFF, 0xE0}, want: "image/jpeg"},
		{name: "gif magic", path: "x.bin", data: []byte("GIF89a....."), want: "image/gif"},
		{name: "webp magic", path: "x.bin", data: []byte("RIFF\x00\x00\x00\x00WEBPVP8 "), want: "image/webp"},
		{name: "ext fallback jpeg", path: "shot.JPEG", data: []byte("nothing recognisable"), want: "image/jpeg"},
		{name: "unsupported", path: "shot.tiff", data: []byte("II*\x00"), wantErr: true},
		{name: "no extension", path: "shot", data: []byte("zzz"), wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := detectMediaType(tt.path, tt.data)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("want error, got %q", got)
				}
				if !strings.Contains(err.Error(), "PNG") {
					t.Errorf("error should name supported formats: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

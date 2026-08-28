package main

import "time"

// Status of a journal entry through the pipeline.
type Status string

const (
	StatusPending   Status = "pending"   // recognised, not yet in Anki (Anki closed / API down)
	StatusCreated   Status = "created"   // note created in Anki
	StatusFailed    Status = "failed"    // unrecoverable: recognition failed or Anki rejected
	StatusDuplicate Status = "duplicate" // Anki already has this phrase
	StatusDeleted   Status = "deleted"   // removed from Anki via journal UI
)

// Extraction is what Claude returns for one screenshot.
type Extraction struct {
	Phrase        string `json:"phrase"`
	TranslationRU string `json:"translation_ru"`
	ExampleEN     string `json:"example_en"`
	ExampleRU     string `json:"example_ru"`
	ImageQuery    string `json:"image_query"`
}

// Entry is one screenshot's journey, persisted in data/journal.json.
type Entry struct {
	ID         string    `json:"id"` // unix-nano based, unique
	CreatedAt  time.Time `json:"created_at"`
	Screenshot string    `json:"screenshot"` // basename inside inbox/processed or inbox/failed
	Status     Status    `json:"status"`
	Error      string    `json:"error,omitempty"`

	Extraction

	MediaFile string `json:"media_file,omitempty"` // basename inside data/media, "" if no image
	NoteID    int64  `json:"note_id,omitempty"`    // Anki note id once created
	Attempts  int    `json:"attempts"`
}

// Extractor turns a screenshot into an Extraction. Implemented by claudeClient.
// Returns errNoPhrase when the image holds no usable English phrase.
type Extractor interface {
	Extract(imagePath string) (Extraction, error)
}

// ImageFinder finds an illustrative image for a query and returns the raw bytes
// plus a filename extension (".jpg"). Implemented by unsplashClient.
// Returns errNoImage when nothing suitable is found; callers treat that as non-fatal.
type ImageFinder interface {
	Find(query string) (data []byte, ext string, err error)
}

// AnkiClient talks to AnkiConnect. Implemented by ankiClient.
type AnkiClient interface {
	// EnsureDeck creates the deck if missing. Idempotent.
	EnsureDeck(deck string) error
	// StoreMedia uploads bytes under filename, returns the stored filename.
	StoreMedia(filename string, data []byte) (string, error)
	// AddNote creates a Basic note. mediaFile may be "" for no image.
	// Returns errDuplicate if Anki rejects it as a duplicate.
	AddNote(deck string, e Extraction, mediaFile string) (noteID int64, err error)
	// DeleteNote removes a note by id.
	DeleteNote(noteID int64) error
	// Ping reports whether AnkiConnect is reachable.
	Ping() error
}

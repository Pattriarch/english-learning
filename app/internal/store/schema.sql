CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  book TEXT NOT NULL,
  unit TEXT,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  title_ru TEXT NOT NULL,
  level TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS letters (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,
  prompt TEXT NOT NULL,
  original TEXT NOT NULL,
  analysis_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topic_events (
  id INTEGER PRIMARY KEY,
  topic_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  letter_id INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS topic_events_topic_idx ON topic_events (topic_id, created_at);

CREATE TABLE IF NOT EXISTS anki_cards (
  id INTEGER PRIMARY KEY,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  note TEXT,
  topic_id TEXT,
  exported_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS anki_cards_queue_idx ON anki_cards (exported_at);

CREATE TABLE IF NOT EXISTS lesson_progress (
  topic_id TEXT NOT NULL,
  scene_idx INTEGER NOT NULL,
  score_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (topic_id)
);

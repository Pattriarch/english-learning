package main

import "errors"

var (
	// errNoPhrase: the screenshot holds no usable English phrase.
	errNoPhrase = errors.New("на скриншоте не найдено английской фразы")
	// errNoImage: no suitable illustration found; not fatal.
	errNoImage = errors.New("картинка не найдена")
	// errDuplicate: Anki already has a note with this phrase.
	errDuplicate = errors.New("карточка уже есть в Anki")
	// errAnkiUnreachable: AnkiConnect not answering; retry later.
	errAnkiUnreachable = errors.New("Anki недоступен")
)

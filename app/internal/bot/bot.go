package bot

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"english/app/internal/anki"
	"english/app/internal/llm"
	"english/app/internal/store"
)

const (
	maxMessageLen = 4000
	freeTextMin   = 200
)

// Analyzer is whatever can break a letter down: the HTTP API client or the one
// that shells out to the `claude` binary.
type Analyzer interface {
	AnalyzeLetter(ctx context.Context, prompt, letterText, topicsCompact string) (*llm.Analysis, error)
	Model() string
}

type Bot struct {
	tg      *tgClient
	store   *store.Store
	llm     Analyzer
	chatID  int64
	siteURL string

	mu       sync.Mutex
	awaiting map[int64]string
	offset   int
}

func New(token string, chatID int64, st *store.Store, client Analyzer, siteURL string) *Bot {
	return &Bot{
		tg:       newTGClient(token),
		store:    st,
		llm:      client,
		chatID:   chatID,
		siteURL:  siteURL,
		awaiting: map[int64]string{},
	}
}

// Run polls Telegram until the context is cancelled.
func (b *Bot) Run(ctx context.Context) {
	log.Printf("bot: long polling started")
	var updateOffset int64
	for {
		if ctx.Err() != nil {
			return
		}
		updates, err := b.tg.getUpdates(ctx, updateOffset)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("bot: getUpdates: %v", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(3 * time.Second):
			}
			continue
		}
		for _, u := range updates {
			if u.UpdateID >= updateOffset {
				updateOffset = u.UpdateID + 1
			}
			b.handle(ctx, u)
		}
	}
}

func (b *Bot) handle(ctx context.Context, u Update) {
	if u.Message == nil {
		return
	}
	chat := u.Message.Chat.ID
	if b.chatID != 0 && chat != b.chatID {
		log.Printf("bot: ignoring message from chat %d", chat)
		return
	}
	text := strings.TrimSpace(u.Message.Text)
	if text == "" {
		return
	}
	var err error
	switch cmd, _ := splitCommand(text); cmd {
	case "/start":
		err = b.tg.sendHTML(ctx, chat, startText(b.siteURL))
	case "/write":
		err = b.sendAssignment(ctx, chat, false)
	case "/write_new":
		err = b.sendAssignment(ctx, chat, true)
	case "/stats":
		err = b.sendStats(ctx, chat)
	case "/topics":
		err = b.sendTopics(ctx, chat)
	case "/anki":
		err = b.sendAnki(ctx, chat)
	default:
		if strings.HasPrefix(text, "/") {
			err = b.tg.sendHTML(ctx, chat, "Не знаю такой команды. Есть /write, /write_new, /anki, /stats, /topics.")
			break
		}
		err = b.handleLetter(ctx, chat, text)
	}
	if err != nil {
		log.Printf("bot: chat %d: %v", chat, err)
	}
}

func splitCommand(text string) (string, string) {
	if !strings.HasPrefix(text, "/") {
		return "", text
	}
	cmd, rest, _ := strings.Cut(text, " ")
	if i := strings.IndexByte(cmd, '@'); i > 0 {
		cmd = cmd[:i]
	}
	return strings.ToLower(cmd), strings.TrimSpace(rest)
}

func startText(siteURL string) string {
	return strings.Join([]string{
		"<b>English Output Trainer</b>",
		"",
		"/write — тема дня, пиши письмо в ответ",
		"/write_new — другая тема",
		"/anki — выгрузить очередь карточек в TSV",
		"/stats — стрик, слабые темы",
		"/topics — где ты по темам",
		"",
		"Любой текст от " + fmt.Sprint(freeTextMin) + " символов разберу и без темы.",
		"Не знаешь слово — пиши его по-русски прямо в письме, переведу.",
		"Тренажёр: " + esc(siteURL),
	}, "\n")
}

// --- assignments ---

func (b *Bot) promptOfTheDay(next bool) Prompt {
	b.mu.Lock()
	defer b.mu.Unlock()
	if next {
		b.offset++
	}
	day := int(time.Now().UTC().Unix() / 86400)
	return Prompts[((day+b.offset)%len(Prompts)+len(Prompts))%len(Prompts)]
}

func (b *Bot) sendAssignment(ctx context.Context, chat int64, next bool) error {
	p := b.promptOfTheDay(next)
	b.mu.Lock()
	b.awaiting[chat] = p.EN
	b.mu.Unlock()
	msg := "✍️ <b>Тема</b>\n\n" + esc(p.EN) + "\n\n<i>" + esc(p.RU) + "</i>\n\nПиши ответ сюда. Не знаешь слово — вставь по-русски."
	return b.tg.sendHTML(ctx, chat, msg)
}

// --- letters ---

func (b *Bot) handleLetter(ctx context.Context, chat int64, text string) error {
	b.mu.Lock()
	assignment, waiting := b.awaiting[chat]
	b.mu.Unlock()
	if !waiting && len([]rune(text)) < freeTextMin {
		return b.tg.sendHTML(ctx, chat, fmt.Sprintf("Коротковато для разбора (нужно от %d символов). Или возьми тему: /write", freeTextMin))
	}
	if b.llm == nil {
		return b.tg.sendHTML(ctx, chat, "Разбор недоступен: не найден claude (или не задан ANTHROPIC_API_KEY при LLM_PROVIDER=api). Смотри лог сервера.")
	}
	if err := b.tg.sendHTML(ctx, chat, "Читаю…"); err != nil {
		log.Printf("bot: ack: %v", err)
	}

	compact, err := b.store.TopicsCompact()
	if err != nil {
		return err
	}
	analysis, err := b.llm.AnalyzeLetter(ctx, assignment, text, compact)
	if err != nil {
		return b.tg.sendHTML(ctx, chat, "Разбор не получился: "+esc(err.Error()))
	}

	b.mu.Lock()
	delete(b.awaiting, chat)
	b.mu.Unlock()

	queued, err := b.persist(assignment, text, analysis)
	if err != nil {
		log.Printf("bot: persist letter: %v", err)
	}
	return b.tg.sendHTML(ctx, chat, b.render(analysis, queued))
}

func (b *Bot) persist(assignment, text string, a *llm.Analysis) (int, error) {
	raw, err := json.Marshal(a)
	if err != nil {
		return 0, err
	}
	letterID, err := b.store.InsertLetter(assignment, text, string(raw))
	if err != nil {
		return 0, err
	}
	for _, e := range a.Errors {
		if e.TopicID == "" {
			continue
		}
		if err := b.store.InsertTopicEvent(e.TopicID, "letter_error", &letterID, e.Quote); err != nil {
			log.Printf("bot: topic event: %v", err)
		}
	}
	errored := map[string]bool{}
	for _, e := range a.Errors {
		errored[e.TopicID] = true
	}
	for _, id := range a.TopicsOK {
		if id == "" || errored[id] {
			continue
		}
		if err := b.store.InsertTopicEvent(id, "letter_ok", &letterID, ""); err != nil {
			log.Printf("bot: topic event: %v", err)
		}
	}
	return b.store.InsertAnkiCards(cardsFrom(a))
}

// cardsFrom prefers the model's own cards and falls back to building them from
// errors and Russian inserts, which always become cards per the design.
func cardsFrom(a *llm.Analysis) []store.AnkiCard {
	if len(a.Cards) > 0 {
		out := make([]store.AnkiCard, 0, len(a.Cards))
		for _, c := range a.Cards {
			out = append(out, store.AnkiCard{Front: c.Front, Back: c.Back, Note: c.Note, TopicID: c.TopicID})
		}
		return out
	}
	out := []store.AnkiCard{}
	for _, e := range a.Errors {
		out = append(out, store.AnkiCard{Front: e.Quote, Back: e.Fix, Note: e.ExplainRU, TopicID: e.TopicID})
	}
	for _, r := range a.RussianInserts {
		note := r.Alt
		out = append(out, store.AnkiCard{Front: r.RU, Back: r.EN, Note: note})
	}
	return out
}

func (b *Bot) render(a *llm.Analysis, queued int) string {
	var s strings.Builder
	if a.Corrected != "" {
		s.WriteString("✅ <b>Как надо</b>\n")
		s.WriteString(esc(a.Corrected))
		s.WriteString("\n")
	}
	if len(a.Errors) > 0 {
		s.WriteString("\n❌ <b>Ошибки</b>\n")
		for i, e := range a.Errors {
			fmt.Fprintf(&s, "%d. <s>%s</s> → <b>%s</b>\n", i+1, esc(e.Quote), esc(e.Fix))
			if e.ExplainRU != "" {
				s.WriteString("    " + esc(e.ExplainRU))
			}
			if t := b.topicTitle(e.TopicID); t != "" {
				s.WriteString(" <i>[" + esc(t) + "]</i>")
			}
			s.WriteString("\n")
		}
	}
	if len(a.Upgrades) > 0 {
		s.WriteString("\n🔥 <b>Сильнее</b>\n")
		for _, u := range a.Upgrades {
			fmt.Fprintf(&s, "• %s → <b>%s</b>\n", esc(u.Quote), esc(u.Better))
			if u.WhyRU != "" {
				s.WriteString("    <i>" + esc(u.WhyRU) + "</i>\n")
			}
		}
	}
	if len(a.RussianInserts) > 0 {
		s.WriteString("\n🇷🇺 <b>Русские вставки</b>\n")
		for _, r := range a.RussianInserts {
			fmt.Fprintf(&s, "• %s → <b>%s</b>\n", esc(r.RU), esc(r.EN))
			if r.Alt != "" {
				s.WriteString("    попроще: <b>" + esc(r.Alt) + "</b>\n")
			}
		}
	}
	if a.SlangBonus != nil && a.SlangBonus.Phrase != "" {
		s.WriteString("\n🎤 <b>" + esc(a.SlangBonus.Phrase) + "</b> — " + esc(a.SlangBonus.MeaningRU) + "\n")
		if a.SlangBonus.Example != "" {
			s.WriteString("<i>" + esc(a.SlangBonus.Example) + "</i>\n")
		}
	}
	if queued > 0 {
		fmt.Fprintf(&s, "\n🃏 %d %s в очереди Anki — /anki\n", queued, plural(queued, "карточка", "карточки", "карточек"))
	}
	if s.Len() == 0 {
		return "Разбор пустой — модель ничего не вернула."
	}
	return s.String()
}

func (b *Bot) topicTitle(id string) string {
	if id == "" {
		return ""
	}
	t, err := b.store.Topic(id)
	if err != nil {
		return id
	}
	if t.TitleRU != "" {
		return t.TitleRU
	}
	return t.Title
}

// --- anki ---

func (b *Bot) sendAnki(ctx context.Context, chat int64) error {
	cards, err := b.store.QueueAnki()
	if err != nil {
		return err
	}
	if len(cards) == 0 {
		return b.tg.sendHTML(ctx, chat, "Очередь пустая. Пиши письма — карточки появятся.")
	}
	out := make([]anki.Card, 0, len(cards))
	ids := make([]int64, 0, len(cards))
	for _, c := range cards {
		out = append(out, anki.Card{Front: c.Front, Back: c.Back, Note: c.Note})
		ids = append(ids, c.ID)
	}
	caption := fmt.Sprintf("%d %s. Импорт в Anki: поля front/back/note, разделитель — таб.",
		len(cards), plural(len(cards), "карточка", "карточки", "карточек"))
	if err := b.tg.sendDocument(ctx, chat, "anki.tsv", caption, anki.TSV(out)); err != nil {
		return err
	}
	return b.store.MarkAnkiExported(ids)
}

// --- stats ---

func (b *Bot) sendStats(ctx context.Context, chat int64) error {
	st, err := b.store.Stats()
	if err != nil {
		return err
	}
	var s strings.Builder
	fmt.Fprintf(&s, "📊 <b>Статистика</b>\n\nПисем: <b>%d</b>\nСтрик: <b>%d</b> %s\nВ очереди Anki: <b>%d</b>\n",
		st.Letters, st.Streak, plural(st.Streak, "день", "дня", "дней"), st.AnkiQueue)
	if len(st.WeakTopics) == 0 {
		s.WriteString("\nСлабых тем нет — либо ты хорош, либо мало писал.\n")
	} else {
		s.WriteString("\n🩹 <b>Слабые темы</b>\n")
		for i, t := range st.WeakTopics {
			if i >= 5 {
				break
			}
			title := t.TitleRU
			if title == "" {
				title = t.Title
			}
			fmt.Fprintf(&s, "• %s — %d %s\n%s\n", esc(title), t.Errors,
				plural(t.Errors, "ошибка", "ошибки", "ошибок"), esc(b.topicURL(t.TopicID)))
		}
	}
	return b.tg.sendHTML(ctx, chat, s.String())
}

func (b *Bot) sendTopics(ctx context.Context, chat int64) error {
	st, err := b.store.Stats()
	if err != nil {
		return err
	}
	msg := fmt.Sprintf(`🗺 <b>Темы: %d</b>

<b>Использование</b> (из писем)
active: %d
shaky: %d
struggling: %d
unknown: %d

<b>Изучение</b> (из тренажёра)
mastered: %d
completed: %d
started: %d
untouched: %d

%s`,
		st.Topics,
		st.Usage[store.UsageActive], st.Usage[store.UsageShaky], st.Usage[store.UsageStruggling], st.Usage[store.UsageUnknown],
		st.Study[store.StudyMastered], st.Study[store.StudyCompleted], st.Study[store.StudyStarted], st.Study[store.StudyUntouched],
		esc(b.siteURL))
	return b.tg.sendHTML(ctx, chat, msg)
}

func (b *Bot) topicURL(topicID string) string {
	base := strings.TrimRight(b.siteURL, "/")
	if base == "" {
		return ""
	}
	return base + "/#/topic/" + topicID
}

// --- text helpers ---

var escaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")

func esc(s string) string { return escaper.Replace(s) }

func plural(n int, one, few, many string) string {
	n = n % 100
	if n >= 11 && n <= 14 {
		return many
	}
	switch n % 10 {
	case 1:
		return one
	case 2, 3, 4:
		return few
	default:
		return many
	}
}

// splitMessage cuts text into chunks of at most limit runes, preferring line
// breaks so HTML tags are never split in half.
func splitMessage(text string, limit int) []string {
	if len([]rune(text)) <= limit {
		return []string{text}
	}
	var out []string
	var cur strings.Builder
	flush := func() {
		if cur.Len() > 0 {
			out = append(out, strings.TrimRight(cur.String(), "\n"))
			cur.Reset()
		}
	}
	for _, line := range strings.Split(text, "\n") {
		for _, piece := range hardSplit(line, limit) {
			if len([]rune(cur.String()))+len([]rune(piece))+1 > limit {
				flush()
			}
			cur.WriteString(piece)
			cur.WriteByte('\n')
		}
	}
	flush()
	return out
}

func hardSplit(line string, limit int) []string {
	runes := []rune(line)
	if len(runes) <= limit {
		return []string{line}
	}
	var out []string
	for len(runes) > limit {
		cut := limit
		for i := limit - 1; i > limit/2; i-- {
			if runes[i] == ' ' {
				cut = i
				break
			}
		}
		out = append(out, strings.TrimRight(string(runes[:cut]), " "))
		runes = runes[cut:]
	}
	if len(runes) > 0 {
		out = append(out, string(runes))
	}
	return out
}

package studio

import (
	"bytes"
	"context"
	"net/http"
	"strings"
	"time"
)

// Ask the official CLI for a status, never read or return its auth cache.
func (s *Server) chatGPTStatus(w http.ResponseWriter, r *http.Request) {
	result := map[string]any{"available": false, "loggedIn": false, "authMethod": "", "message": "Codex не найден. Установи Codex CLI и выполни codex login"}
	bin, err := codexBinary()
	if err != nil {
		jsonResponse(w, 200, result)
		return
	}
	result["available"] = true
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	cmd, err := codexCommand(ctx, bin, "login", "status")
	if err != nil {
		result["message"] = "Не удалось запустить Codex. Проверь установку CLI"
		jsonResponse(w, 200, result)
		return
	}
	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output
	err = cmd.Run()
	status := strings.ToLower(output.String())
	switch {
	case ctx.Err() != nil:
		result["message"] = "Codex не ответил. Попробуй ещё раз"
	case err != nil:
		result["message"] = "Вход не выполнен. Открой инструкцию и выполни codex login"
	case strings.Contains(status, "logged in using chatgpt"):
		result["loggedIn"] = true
		result["authMethod"] = "chatgpt"
		result["message"] = "Вход через ChatGPT выполнен. Токен вставлять не нужно. Нажми «Проверить подключение», чтобы проверить ответ модели"
	case strings.Contains(status, "logged in using an api key") || strings.Contains(status, "logged in using api key"):
		result["loggedIn"] = true
		result["authMethod"] = "api"
		result["message"] = "Codex использует API-ключ с отдельной оплатой. Для аккаунта ChatGPT выполни codex login"
	default:
		result["message"] = "Codex установлен. Выполни codex login status в Terminal или PowerShell, чтобы проверить способ входа"
	}
	jsonResponse(w, 200, result)
}

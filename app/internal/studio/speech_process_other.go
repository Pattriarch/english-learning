//go:build !windows

package studio

import "context"

func runWindowsSpeech(context.Context, string, string, string, string) error {
	return errSpeechUnavailable
}

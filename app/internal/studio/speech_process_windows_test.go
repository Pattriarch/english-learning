package studio

import (
	"context"
	"strings"
	"testing"
)

func TestSpeechWindowsCommandUsesHiddenProcessAndPathsOnly(t *testing.T) {
	cmd := speechCommand(context.Background(), `C:\app\scripts\speak-local.ps1`, `C:\private\input.json`, `C:\private\speech.wav`, `C:\private\voice.json`)
	if cmd.SysProcAttr == nil || !cmd.SysProcAttr.HideWindow || cmd.SysProcAttr.CreationFlags&0x08000000 == 0 {
		t.Fatal("speech helper may open a visible console")
	}
	args := strings.Join(cmd.Args, " ")
	if strings.Contains(args, "-Command") || strings.Contains(args, "-EncodedCommand") || !strings.Contains(args, "-File") || !strings.Contains(args, "-InputPath") {
		t.Fatal("speech text must be data in a file, never a command expression")
	}
}

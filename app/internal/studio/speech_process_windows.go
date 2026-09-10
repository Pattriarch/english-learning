package studio

import (
	"context"
	"os/exec"
	"syscall"
)

func speechCommand(ctx context.Context, script, input, wav, metadata string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-InputPath", input, "-OutputPath", wav, "-MetadataPath", metadata)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	return cmd
}

func runWindowsSpeech(ctx context.Context, script, input, wav, metadata string) error {
	// Only trusted paths enter the argument list. The user's text is read as JSON
	// data by the script and spoken as plain text, never SSML or PowerShell code.
	if err := speechCommand(ctx, script, input, wav, metadata).Run(); err != nil {
		return errSpeechUnavailable
	}
	return nil
}

package llm

import "testing"

func TestCLIResult(t *testing.T) {
	tests := []struct {
		name    string
		out     string
		want    string
		wantErr bool
	}{
		{
			name: "plain result",
			out:  `{"type":"result","subtype":"success","is_error":false,"result":"{\"corrected\":\"ok\"}"}`,
			want: `{"corrected":"ok"}`,
		},
		{
			name:    "error envelope",
			out:     `{"type":"result","subtype":"error_max_turns","is_error":true,"result":"hit the limit"}`,
			wantErr: true,
		},
		{
			name:    "empty result",
			out:     `{"type":"result","is_error":false,"result":"   "}`,
			wantErr: true,
		},
		{
			name:    "not json at all",
			out:     "Invalid API key · Fix external API key",
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := cliResult([]byte(tt.out))
			if tt.wantErr {
				if err == nil {
					t.Fatalf("want error, got result %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
		})
	}
}

// The CLI wraps the model's answer as a JSON string, so the analysis parser has
// to survive one extra unwrapping plus the markdown fence models like to add.
func TestCLIResultFeedsParseAnalysis(t *testing.T) {
	out := `{"type":"result","is_error":false,"result":"` +
		`` + "```" + `json\n{\"corrected\":\"I fixed it yesterday.\",\"errors\":[{\"quote\":\"I have fixed it\",\"fix\":\"I fixed it\",\"explain_ru\":\"yesterday\",\"topic_id\":\"egiu-013\"}]}\n` + "```" + `"}`
	raw, err := cliResult([]byte(out))
	if err != nil {
		t.Fatalf("cliResult: %v", err)
	}
	a, err := ParseAnalysis(raw)
	if err != nil {
		t.Fatalf("ParseAnalysis: %v", err)
	}
	if a.Corrected != "I fixed it yesterday." {
		t.Fatalf("corrected = %q", a.Corrected)
	}
	if len(a.Errors) != 1 || a.Errors[0].TopicID != "egiu-013" {
		t.Fatalf("errors = %+v", a.Errors)
	}
}

func TestNewCLIDefaults(t *testing.T) {
	c := NewCLI("", "")
	if c.bin != "claude" {
		t.Fatalf("bin = %q", c.bin)
	}
	if c.Model() != cliDefaultModel {
		t.Fatalf("model = %q", c.Model())
	}
	if got := NewCLI("/opt/claude", "opus").Model(); got != "opus" {
		t.Fatalf("model override = %q", got)
	}
}

package main

import (
	"strings"
	"testing"
	"time"
)

func TestParseTimeValidRFC3339(t *testing.T) {
	want := time.Date(2026, time.April, 7, 12, 34, 56, 0, time.UTC)

	got, err := parseTime(want.Format(time.RFC3339))
	if err != nil {
		t.Fatalf("parseTime returned error: %v", err)
	}
	if !got.Equal(want) {
		t.Fatalf("parseTime = %v, want %v", got, want)
	}
}

func TestSanitize(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"ascii lowercase", "hello world", "hello-world"},
		{"ascii uppercase", "Hello World", "hello-world"},
		{"digits preserved", "meeting 42", "meeting-42"},
		{"hyphens preserved", "pre-call", "pre-call"},
		{"special chars dropped", "a!b@c#d", "abcd"},
		{"accented letters", "café résumé", "café-résumé"},
		{"CJK preserved", "会議メモ", "会議メモ"},
		{"mixed unicode", "Ñoño 2026", "ñoño-2026"},
		{"underscore to hyphen", "my_meeting", "my-meeting"},
		{"empty string", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := sanitize(tt.input)
			if got != tt.want {
				t.Errorf("sanitize(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestParseTimeInvalidRFC3339(t *testing.T) {
	_, err := parseTime("not-a-time")
	if err == nil {
		t.Fatal("parseTime error = nil, want error")
	}
	if !strings.Contains(err.Error(), "parse time \"not-a-time\"") {
		t.Fatalf("parseTime error = %q, want parse context", err)
	}
}

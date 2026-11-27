package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Reopening the same container must resume after the last durably queued line.
func TestJournalResume(t *testing.T) {
	dir := t.TempDir()
	testctl := filepath.Join(dir, "journalctl")
	if err := os.WriteFile(testctl, []byte("#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$CAPTURE_ARGS\"\nprintf '%s\\n' '{\"__CURSOR\":\"cursor1\",\"__REALTIME_TIMESTAMP\":\"1764288000123456\",\"MESSAGE\":\"hello\"}'\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	args := filepath.Join(dir, "args")
	t.Setenv("CAPTURE_ARGS", args)
	q, err := openQueue(dir, 64<<20, Source{Service: "one"})
	if err != nil {
		t.Fatal(err)
	}
	defer q.db.Close()
	for _, container := range []string{"first", "first", "second"} {
		prev, _ := os.ReadFile(args)
		_ = readJournal(context.Background(), q, container)
		data, err := os.ReadFile(args)
		if err != nil {
			t.Fatal(err)
		}
		resume := container == "first" && len(prev) > 0
		if strings.Contains(string(data), "--after-cursor\ncursor1") != resume || !strings.Contains(string(data), "CONTAINER_ID_FULL="+container) {
			t.Fatalf("unexpected journal arguments %s", data)
		}
		id, b, err := q.first()
		if err != nil {
			t.Fatal(err)
		}
		var batch Batch
		// The line keeps journald's time, to the microsecond.
		if err = json.Unmarshal(b, &batch); err != nil || batch.Signal != "stdout" || string(batch.Payload) != `[{"at":"2025-11-28T00:00:00.123456Z","line":"hello"}]` {
			t.Fatalf("unexpected batch %s: %v", b, err)
		}
		if err = q.ack(id); err != nil {
			t.Fatal(err)
		}
	}
}

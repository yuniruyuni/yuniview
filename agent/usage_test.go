package main

import (
	"bytes"
	"testing"
	"time"
)

func TestDailyUsageSeparation(t *testing.T) {
	key := []byte("test-key")
	mark := func(service, day, kind string) []byte {
		return usageMark(key, service, kind, day, "private-account-id")
	}
	initial := mark("a", "2026-11-22", "account")
	if bytes.Contains(initial, []byte("private-account-id")) || !bytes.Equal(initial, mark("a", "2026-11-22", "account")) {
		t.Fatal("invalid pseudonym")
	}
	for _, other := range [][]byte{mark("b", "2026-11-22", "account"), mark("a", "2026-11-23", "account"), mark("a", "2026-11-22", "browser")} {
		if bytes.Equal(initial, other) {
			t.Fatal("usage scopes collided")
		}
	}
	if time.Date(2026, 11, 22, 15, 0, 0, 0, time.UTC).In(japan).Format(time.DateOnly) != "2026-11-23" {
		t.Fatal("JST boundary")
	}
}

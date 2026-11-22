package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"regexp"
	"time"
)

var browserID = regexp.MustCompile("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
var japan = time.FixedZone("JST", 9*3600)

func usageMark(key []byte, service, kind, day, identity string) []byte {
	mac := hmac.New(sha256.New, key)
	fmt.Fprintf(mac, "%s\x00%s\x00%s\x00%s", service, kind, day, identity)
	data, _ := json.Marshal(map[string]string{"day": day, "kind": kind, "digest": hex.EncodeToString(mac.Sum(nil))})
	return data
}

func serveUsage(ctx context.Context, q *queue, socket, keyPath, kind string) (func(), error) {
	if kind != "browser" && kind != "account" {
		return nil, fmt.Errorf("invalid usage kind")
	}
	key, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, err
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("usage key must be 32 bytes")
	}
	listener, err := net.Listen("unix", socket)
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /visit", func(w http.ResponseWriter, r *http.Request) {
		// Browsers may only submit generated UUIDs. Account-mode callers are authenticated by the app.
		b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 256))
		if err != nil || len(b) == 0 || (kind == "browser" && !browserID.Match(b)) {
			w.WriteHeader(400)
			return
		}
		day := time.Now().In(japan).Format(time.DateOnly)
		if err = q.add("usage", usageMark(key, q.source.Service, kind, day, string(b)), nil); err != nil {
			w.WriteHeader(503)
			return
		}
		w.WriteHeader(204)
	})
	server := http.Server{Handler: mux, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, MaxHeaderBytes: 8192}
	done := make(chan struct{})
	go func() { defer close(done); _ = server.Serve(listener) }()
	// An empty digest marks a measured day, including days with zero visitors.
	stop, cancel := context.WithCancel(ctx)
	ticksDone := make(chan struct{})
	go func() {
		defer close(ticksDone)
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		last := ""
		for {
			day := time.Now().In(japan).Format(time.DateOnly)
			if day != last {
				data, _ := json.Marshal(map[string]string{"kind": kind, "day": day, "digest": ""})
				if q.add("usage", data, nil) == nil {
					last = day
				}
			}
			select {
			case <-stop.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	return func() { cancel(); _ = server.Shutdown(context.Background()); <-done; <-ticksDone }, nil
}

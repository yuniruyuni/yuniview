package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

type sender struct {
	client              *http.Client
	endpoint, tokenFile string
}

func newSender(endpoint, token, socket string) sender {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if socket != "" {
		transport.Proxy = nil
		transport.DialContext = func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", socket)
		}
	}
	return sender{&http.Client{Transport: transport, Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, endpoint, token}
}
func (s sender) post(ctx context.Context, b []byte) error {
	credential, err := os.ReadFile(s.tokenFile)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", s.endpoint, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(string(credential)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("ingest HTTP %d", resp.StatusCode)
	}
	return nil
}
func (s sender) run(ctx context.Context, q *queue) {
	delay := time.Second
	for ctx.Err() == nil {
		id, b, err := q.first()
		if err == nil && b == nil {
			select {
			case <-ctx.Done():
				return
			case <-q.wake:
			}
			continue
		}
		if err == nil {
			err = s.post(ctx, b)
		}
		if err == nil {
			err = q.ack(id)
		}
		if err == nil {
			delay = time.Second
			continue
		}
		log.Printf("delivery pending: %v", err)
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		delay = min(2*delay, 30*time.Second)
	}
}

package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os/exec"
	"time"

	bolt "go.etcd.io/bbolt"
)

func followJournal(ctx context.Context, q *queue, container string) {
	for ctx.Err() == nil {
		err := readJournal(ctx, q, container)
		if ctx.Err() != nil {
			return
		}
		log.Printf("retrying journal input: %v", err)
		select {
		case <-ctx.Done():
			return
		case <-time.After(3 * time.Second):
		}
	}
}

func readJournal(ctx context.Context, q *queue, container string) error {
	args := []string{"--follow", "--no-pager", "--output=json", "--output-fields=MESSAGE", "CONTAINER_ID_FULL=" + container}
	err := q.db.View(func(tx *bolt.Tx) error {
		var cursor struct{ Container, Cursor string }
		if b := tx.Bucket(meta).Get([]byte("logCursor")); b != nil {
			if err := json.Unmarshal(b, &cursor); err != nil {
				return err
			}
		}
		if cursor.Container == container && cursor.Cursor != "" {
			args = append(args, "--after-cursor", cursor.Cursor, "--lines=all")
		} else {
			args = append(args, "--lines=20")
		}
		return nil
	})
	if err != nil {
		return err
	}
	child, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := exec.CommandContext(child, "journalctl", args...)
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err = cmd.Start(); err != nil {
		return err
	}
	defer func() { cancel(); _ = cmd.Wait() }()
	scan := bufio.NewScanner(pipe)
	scan.Buffer(make([]byte, 64<<10), 16<<20)
	for scan.Scan() {
		var entry struct {
			Cursor  string          `json:"__CURSOR"`
			Message json.RawMessage `json:"MESSAGE"`
		}
		if err = json.Unmarshal(scan.Bytes(), &entry); err != nil {
			return err
		}
		if entry.Cursor == "" {
			return fmt.Errorf("missing journal cursor")
		}
		var line string
		if len(entry.Message) > 0 && entry.Message[0] == '[' {
			var data []byte
			if err = json.Unmarshal(entry.Message, &data); err != nil {
				return err
			}
			line = string(data)
		} else if err = json.Unmarshal(entry.Message, &line); err != nil {
			return err
		}
		if len(line) > 256<<10 {
			line = line[:256<<10] + " [truncated]"
		}
		payload, _ := json.Marshal([]string{line})
		cursor, _ := json.Marshal(struct{ Container, Cursor string }{container, entry.Cursor})
		for {
			err = q.add("stdout", payload, cursor)
			if !errors.Is(err, errFull) {
				break
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Second):
			}
		}
		if err != nil {
			return err
		}
	}
	if err = scan.Err(); err != nil {
		return err
	}
	return fmt.Errorf("journal stream closed")
}

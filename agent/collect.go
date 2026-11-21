package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	bolt "go.etcd.io/bbolt"
)

type checkpoint struct {
	Device, Inode uint64
	Offset        int64
	Path          string
}
type tailer struct {
	final bool
	path  string
	file  *os.File
	pos   checkpoint
}

func (t *tailer) close() {
	if t.file != nil {
		t.file.Close()
		t.file = nil
	}
}
func (t *tailer) poll(q *queue) error {
	if t.file == nil {
		f, err := os.Open(t.path)
		if err != nil {
			return err
		}
		info, err := f.Stat()
		if err != nil {
			f.Close()
			return err
		}
		st := info.Sys().(*syscall.Stat_t)
		pos := checkpoint{Device: uint64(st.Dev), Inode: st.Ino, Path: t.path}
		err = q.db.View(func(tx *bolt.Tx) error {
			b := tx.Bucket(meta).Get([]byte("logCursor"))
			if b == nil {
				return nil
			}
			var saved checkpoint
			if err := json.Unmarshal(b, &saved); err != nil {
				return err
			}
			if saved.Device == pos.Device && saved.Inode == pos.Inode && saved.Path == pos.Path && saved.Offset <= info.Size() {
				pos.Offset = saved.Offset
			}
			return nil
		})
		if err != nil {
			f.Close()
			return err
		}
		t.file, t.pos = f, pos
	}
	info, err := t.file.Stat()
	if err != nil {
		return err
	}
	if info.Size() < t.pos.Offset {
		t.pos.Offset = 0
	}
	if _, err = t.file.Seek(t.pos.Offset, 0); err != nil {
		return err
	}
	reader := bufio.NewReaderSize(t.file, 64<<10)
	next := t.pos
	var lines []string
	latest, statErr := os.Stat(t.path)
	rotated := statErr == nil && !os.SameFile(info, latest)
	for len(lines) < 128 && next.Offset-t.pos.Offset < 256<<10 {
		data, err := reader.ReadSlice('\n')
		if err == io.EOF && ((!rotated && !t.final) || len(data) == 0) {
			break
		}
		if err != nil && err != io.EOF && err != bufio.ErrBufferFull {
			return err
		}
		lines = append(lines, strings.TrimSuffix(string(data), "\n"))
		next.Offset += int64(len(data))
	}
	if len(lines) == 0 {
		if rotated {
			t.close()
		}
		return nil
	}
	b, err := json.Marshal(lines)
	if err != nil {
		return err
	}
	cursor, _ := json.Marshal(next)
	if err = q.add("stdout", b, cursor); err != nil {
		return err
	}
	t.pos = next
	return nil
}
func sample(dir string, q *queue) error {
	cpu, err := os.ReadFile(filepath.Join(dir, "cpu.stat"))
	if err != nil {
		return err
	}
	memory, err := os.ReadFile(filepath.Join(dir, "memory.current"))
	if err != nil {
		return err
	}
	mem, err := strconv.ParseUint(strings.TrimSpace(string(memory)), 10, 64)
	if err != nil {
		return err
	}
	for line := range strings.SplitSeq(string(cpu), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == "usage_usec" {
			n, err := strconv.ParseUint(fields[1], 10, 64)
			if err != nil {
				return err
			}
			b, _ := json.Marshal(map[string]uint64{"cpuUsageUsec": n, "memoryBytes": mem})
			return q.add("resources", b, nil)
		}
	}
	return fmt.Errorf("missing usage_usec")
}
func periodic(ctx context.Context, interval time.Duration, name string, fn func() error) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	var last string
	for ctx.Err() == nil {
		err := fn()
		if err != nil && err.Error() != last {
			log.Printf("%s: %v", name, err)
			last = err.Error()
		} else if err == nil {
			last = ""
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

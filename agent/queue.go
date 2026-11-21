package main

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	bolt "go.etcd.io/bbolt"
)

const maxBatch = 8 << 20

var errFull = errors.New("queue capacity exceeded")
var errLarge = errors.New("encoded batch exceeds 8 MiB")
var pending = []byte("pending")
var meta = []byte("metadata")

type Source struct {
	Service  string `json:"service"`
	Workload string `json:"workload"`
	Instance string `json:"instance"`
	Slot     string `json:"slot,omitempty"`
	Revision string `json:"revision,omitempty"`
}
type Batch struct {
	ID      string          `json:"id"`
	Source  Source          `json:"source"`
	Signal  string          `json:"signal"`
	Time    time.Time       `json:"time"`
	Payload json.RawMessage `json:"payload"`
}
type queue struct {
	db     *bolt.DB
	limit  uint64
	source Source
	wake   chan struct{}
}

func openQueue(dir string, limit uint64, source Source) (*queue, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	db, err := bolt.Open(filepath.Join(dir, "spool.db"), 0600, &bolt.Options{Timeout: time.Second})
	if err != nil {
		return nil, err
	}
	err = db.Update(func(tx *bolt.Tx) error {
		for _, name := range [][]byte{pending, meta} {
			if _, err := tx.CreateBucketIfNotExists(name); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		db.Close()
		return nil, err
	}
	return &queue{db, limit, source, make(chan struct{}, 1)}, nil
}
func bytesKey(n uint64) []byte { return binary.BigEndian.AppendUint64(nil, n) }
func used(m *bolt.Bucket) uint64 {
	v := m.Get([]byte("bytes"))
	if v == nil {
		return 0
	}
	return binary.BigEndian.Uint64(v)
}
func (q *queue) add(signal string, payload json.RawMessage, cursor []byte) error {
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return err
	}
	b, err := json.Marshal(Batch{hex.EncodeToString(id[:]), q.source, signal, time.Now().UTC(), payload})
	if err != nil {
		return err
	}
	if len(b) > maxBatch {
		return errLarge
	}
	err = q.db.Update(func(tx *bolt.Tx) error {
		m, p := tx.Bucket(meta), tx.Bucket(pending)
		size := used(m) + uint64(len(b))
		if size > q.limit {
			return errFull
		}
		n, err := p.NextSequence()
		if err != nil {
			return err
		}
		if err = p.Put(bytesKey(n), b); err != nil {
			return err
		}
		if cursor != nil {
			if err = m.Put([]byte("logCursor"), cursor); err != nil {
				return err
			}
		}
		return m.Put([]byte("bytes"), bytesKey(size))
	})
	if err == nil {
		select {
		case q.wake <- struct{}{}:
		default:
		}
	}
	return err
}
func (q *queue) first() (uint64, []byte, error) {
	var id uint64
	var body []byte
	err := q.db.View(func(tx *bolt.Tx) error {
		k, v := tx.Bucket(pending).Cursor().First()
		if k != nil {
			id = binary.BigEndian.Uint64(k)
			body = append(body, v...)
		}
		return nil
	})
	return id, body, err
}
func (q *queue) ack(id uint64) error {
	return q.db.Update(func(tx *bolt.Tx) error {
		p, m := tx.Bucket(pending), tx.Bucket(meta)
		k := bytesKey(id)
		v := p.Get(k)
		if v == nil {
			return fmt.Errorf("batch %d missing", id)
		}
		n := used(m) - uint64(len(v))
		if err := p.Delete(k); err != nil {
			return err
		}
		return m.Put([]byte("bytes"), bytesKey(n))
	})
}

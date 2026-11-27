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
var staged = []byte("staged")
var meta = []byte("metadata")

// Signals whose deliveries are held and sent together. Each delivery costs
// the center a stored batch, which outweighs a few seconds of cgroup samples
// or log lines. Usage marks stay alone: the center reads each as one mark.
var mergeable = map[string]bool{"traces": true, "metrics": true, "logs": true, "stdout": true, "resources": true}

// The payload a sealed batch may carry, well under the center's 8 MiB.
const sealBytes = 4 << 20

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
	// Whether mergeable signals wait in the staged bucket for seal. Off, each
	// add is a batch of its own.
	hold bool
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
		for _, name := range [][]byte{pending, staged, meta} {
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
	return &queue{db: db, limit: limit, source: source, wake: make(chan struct{}, 1)}, nil
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
	hold := q.hold && mergeable[signal]
	err = q.db.Update(func(tx *bolt.Tx) error {
		m, p := tx.Bucket(meta), tx.Bucket(pending)
		if hold {
			p = tx.Bucket(staged)
		}
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
	if err == nil && !hold {
		q.notify()
	}
	return err
}
func (q *queue) notify() {
	select {
	case q.wake <- struct{}{}:
	default:
	}
}

// seal turns what waits in the staged bucket into batches, one per signal
// unless the payload grows past sealBytes. Staged deliveries are already
// durable, so holding them loses nothing when the agent stops.
func (q *queue) seal() error {
	sealed := false
	err := q.db.Update(func(tx *bolt.Tx) error {
		m, p, s := tx.Bucket(meta), tx.Bucket(pending), tx.Bucket(staged)
		type group struct {
			signal string
			time   time.Time
			parts  []json.RawMessage
			bytes  int
		}
		var groups []*group
		open := map[string]*group{}
		var keys [][]byte
		var freed uint64
		err := s.ForEach(func(k, v []byte) error {
			var b Batch
			if err := json.Unmarshal(v, &b); err != nil {
				return err
			}
			keys = append(keys, append([]byte(nil), k...))
			freed += uint64(len(v))
			g := open[b.Signal]
			if g == nil || g.bytes+len(b.Payload) > sealBytes {
				g = &group{signal: b.Signal, time: b.Time}
				open[b.Signal] = g
				groups = append(groups, g)
			}
			g.parts = append(g.parts, b.Payload)
			g.bytes += len(b.Payload)
			return nil
		})
		if err != nil || len(keys) == 0 {
			return err
		}
		size := used(m) - freed
		for _, g := range groups {
			payload, err := merge(g.signal, g.parts)
			if err != nil {
				return err
			}
			var id [16]byte
			if _, err = rand.Read(id[:]); err != nil {
				return err
			}
			b, err := json.Marshal(Batch{hex.EncodeToString(id[:]), q.source, g.signal, g.time, payload})
			if err != nil {
				return err
			}
			n, err := p.NextSequence()
			if err != nil {
				return err
			}
			if err = p.Put(bytesKey(n), b); err != nil {
				return err
			}
			size += uint64(len(b))
		}
		for _, k := range keys {
			if err := s.Delete(k); err != nil {
				return err
			}
		}
		sealed = true
		return m.Put([]byte("bytes"), bytesKey(size))
	})
	if sealed {
		q.notify()
	}
	return err
}

// merge combines deliveries of one signal into the payload of one batch.
// OTLP exports join their resource lists (and buffered event counts), log
// lines join one list, and cgroup samples become a list of samples.
func merge(signal string, parts []json.RawMessage) (json.RawMessage, error) {
	if len(parts) == 1 && signal != "resources" {
		return parts[0], nil
	}
	switch signal {
	case "resources":
		return json.Marshal(map[string][]json.RawMessage{"samples": parts})
	case "stdout":
		var lines []json.RawMessage
		for _, part := range parts {
			var some []json.RawMessage
			if err := json.Unmarshal(part, &some); err != nil {
				return nil, err
			}
			lines = append(lines, some...)
		}
		return json.Marshal(lines)
	default:
		lists := map[string][]json.RawMessage{}
		for _, part := range parts {
			var fields map[string][]json.RawMessage
			if err := json.Unmarshal(part, &fields); err != nil {
				return nil, err
			}
			for k, v := range fields {
				lists[k] = append(lists[k], v...)
			}
		}
		return json.Marshal(lists)
	}
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

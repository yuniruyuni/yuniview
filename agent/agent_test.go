package main

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	logs "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	metrics "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	traces "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	cv "go.opentelemetry.io/proto/otlp/common/v1"
	lv "go.opentelemetry.io/proto/otlp/logs/v1"
	mv "go.opentelemetry.io/proto/otlp/metrics/v1"
	tv "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

var testSource = Source{Service: "demo", Workload: "app", Instance: "instance-1", Slot: "blue"}

func TestGRPCAndRetryAfterRestart(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	dir := t.TempDir()
	q, err := openQueue(dir, maxBatch, testSource)
	if err != nil {
		t.Fatal(err)
	}
	server := grpc.NewServer()
	traces.RegisterTraceServiceServer(server, traceService{q: q})
	logs.RegisterLogsServiceServer(server, logService{q: q})
	metrics.RegisterMetricsServiceServer(server, metricService{q: q})
	listener := bufconn.Listen(1024 * 1024)
	go server.Serve(listener)
	defer server.Stop()
	conn, err := grpc.NewClient("passthrough:///test", grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, err = traces.NewTraceServiceClient(conn).Export(ctx, &traces.ExportTraceServiceRequest{ResourceSpans: []*tv.ResourceSpans{{ScopeSpans: []*tv.ScopeSpans{{Spans: []*tv.Span{{Name: "checkout"}}}}}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = metrics.NewMetricsServiceClient(conn).Export(ctx, &metrics.ExportMetricsServiceRequest{}); err != nil {
		t.Fatal(err)
	}
	if _, err = logs.NewLogsServiceClient(conn).Export(ctx, &logs.ExportLogsServiceRequest{}); err != nil {
		t.Fatal(err)
	}
	id, body, err := q.first()
	if err != nil || id == 0 {
		t.Fatal(id, err)
	}
	token := filepath.Join(dir, "token")
	if err = os.WriteFile(token, []byte("test\n"), 0600); err != nil {
		t.Fatal(err)
	}
	var status int = 503
	var received Batch
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test" {
			t.Error("missing credential")
		}
		raw, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(raw, &received); err != nil {
			t.Error(err)
		}
		w.WriteHeader(status)
	}))
	defer endpoint.Close()
	s := newSender(endpoint.URL, token, "")
	if err = s.post(ctx, body); err == nil {
		t.Fatal("acknowledged failed delivery")
	}
	if err = q.db.Close(); err != nil {
		t.Fatal(err)
	}
	q, err = openQueue(dir, maxBatch, testSource)
	if err != nil {
		t.Fatal(err)
	}
	defer q.db.Close()
	retryID, retry, err := q.first()
	if err != nil || retryID != id || string(body) != string(retry) {
		t.Fatal("restart lost batch")
	}
	status = 204
	for _, signal := range []string{"traces", "metrics", "logs"} {
		id, body, err = q.first()
		if err != nil {
			t.Fatal(err)
		}
		if err = s.post(ctx, body); err != nil {
			t.Fatal(err)
		}
		if received.Signal != signal || received.Source != testSource {
			t.Fatalf("unexpected envelope %+v", received)
		}
		if err = q.ack(id); err != nil {
			t.Fatal(err)
		}
	}
	if _, b, err := q.first(); err != nil || b != nil {
		t.Fatal("queue not drained")
	}
}
func TestTailResourcesAndCapacity(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "stdout")
	write := func(path, value string) {
		t.Helper()
		if err := os.WriteFile(path, []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write(path, "first\npartial")
	q, err := openQueue(dir, 1, testSource)
	if err != nil {
		t.Fatal(err)
	}
	defer q.db.Close()
	tail := tailer{path: path}
	defer tail.close()
	if err := tail.poll(q); err != errFull {
		t.Fatalf("expected backpressure, got %v", err)
	}
	q.limit = maxBatch
	check := func(signal, payload string) {
		t.Helper()
		id, b, e := q.first()
		if e != nil {
			t.Fatal(e)
		}
		var batch Batch
		if e = json.Unmarshal(b, &batch); e != nil || batch.Signal != signal || string(batch.Payload) != payload {
			t.Fatalf("%s %v", b, e)
		}
		if e = q.ack(id); e != nil {
			t.Fatal(e)
		}
	}
	if err = tail.poll(q); err != nil {
		t.Fatal(err)
	}
	check("stdout", `["first"]`)
	tail.close()
	if err = tail.poll(q); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(path, path+".1"); err != nil {
		t.Fatal(err)
	}
	write(path, "new\n")
	for i := 0; i < 3; i++ {
		if err = tail.poll(q); err != nil {
			t.Fatal(err)
		}
	}
	check("stdout", `["partial"]`)
	check("stdout", `["new"]`)
	write(filepath.Join(dir, "cpu.stat"), "usage_usec 123\n")
	write(filepath.Join(dir, "memory.current"), "456")
	if err = sample(dir, q); err != nil {
		t.Fatal(err)
	}
	check("resources", `{"cpuUsageUsec":123,"memoryBytes":456}`)
}

// The smoke script sets this address for the separately running agent binary.
func TestLiveExport(t *testing.T) {
	addr := os.Getenv("YUNIVIEW_TEST_GRPC")
	if addr == "" {
		t.Skip("run bin/test-agent.sh for PostgreSQL integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, err = traces.NewTraceServiceClient(conn).Export(ctx, &traces.ExportTraceServiceRequest{ResourceSpans: []*tv.ResourceSpans{{ScopeSpans: []*tv.ScopeSpans{{Spans: []*tv.Span{{Name: "checkout", TraceId: []byte("0123456789abcdef"), SpanId: []byte("abcdefgh")}}}}}}}, grpc.WaitForReady(true))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = logs.NewLogsServiceClient(conn).Export(ctx, &logs.ExportLogsServiceRequest{ResourceLogs: []*lv.ResourceLogs{{ScopeLogs: []*lv.ScopeLogs{{LogRecords: []*lv.LogRecord{{Body: &cv.AnyValue{Value: &cv.AnyValue_StringValue{StringValue: "otlp message"}}}}}}}}}); err != nil {
		t.Fatal(err)
	}
	if _, err = metrics.NewMetricsServiceClient(conn).Export(ctx, &metrics.ExportMetricsServiceRequest{ResourceMetrics: []*mv.ResourceMetrics{{ScopeMetrics: []*mv.ScopeMetrics{{Metrics: []*mv.Metric{{Name: "cart.items", Data: &mv.Metric_Gauge{Gauge: &mv.Gauge{DataPoints: []*mv.NumberDataPoint{{Value: &mv.NumberDataPoint_AsInt{AsInt: 3}}}}}}}}}}}}); err != nil {
		t.Fatal(err)
	}
}

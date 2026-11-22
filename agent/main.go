package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	logs "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	metrics "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	traces "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/grpc"
	_ "google.golang.org/grpc/encoding/gzip"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
func run() error {
	var src Source
	flag.StringVar(&src.Service, "service", "", "registered service")
	flag.StringVar(&src.Instance, "instance", "", "container instance ID")
	flag.StringVar(&src.Workload, "workload", "app", "workload name")
	flag.StringVar(&src.Slot, "slot", "", "blue/green slot")
	flag.StringVar(&src.Revision, "revision", "", "deployment revision")
	listen := flag.String("listen", "127.0.0.1:4317", "OTLP/gRPC listen address")
	signals := flag.String("otlp", "traces,metrics,logs", "enabled comma-separated OTLP signals (empty disables receiver)")
	endpoint := flag.String("endpoint", "", "central batch URL including /api/agent/v1/batches")
	token := flag.String("token-file", "", "file containing source-specific bearer credential")
	socket := flag.String("socket", "", "optional Unix socket for central HTTP transport")
	state := flag.String("state", "/var/lib/yuniview-agent", "persistent queue directory")
	limit := flag.Uint64("queue-bytes", 64<<20, "maximum pending payload bytes")
	usage := flag.String("usage-kind", "", "enable per-day browser or account counts")
	usageSocket := flag.String("usage-socket", "", "private visit socket")
	usageKey := flag.String("usage-key", "", "service-wide private key file")
	journal := flag.String("journal-container", "", "container ID for journald stdout/stderr")
	logfile := flag.String("log-file", "", "optional target stdout/stderr log path")
	cgroup := flag.String("cgroup", "", "optional target cgroup v2 directory")
	interval := flag.Duration("sample-interval", 10*time.Second, "resource sampling period")
	flush := flag.Duration("shutdown-timeout", 3*time.Second, "maximum final delivery time (zero leaves queued data on disk)")
	flag.Parse()
	if src.Service == "" || src.Instance == "" || src.Workload == "" || *token == "" {
		return fmt.Errorf("service, instance, workload and token-file are required")
	}
	for _, v := range []string{src.Service, src.Instance, src.Workload, src.Revision, src.Slot} {
		if len(v) > 256 || strings.ContainsRune(v, 0) {
			return fmt.Errorf("invalid source field")
		}
	}
	u, err := url.Parse(*endpoint)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil {
		return fmt.Errorf("invalid endpoint")
	}
	if *limit < maxBatch || *interval <= 0 || *flush < 0 {
		return fmt.Errorf("queue-bytes must be at least %d with a positive sample-interval and nonnegative shutdown-timeout", maxBatch)
	}
	if *journal != "" && *logfile != "" {
		return fmt.Errorf("choose one stdout source")
	}
	if *signals == "" && *logfile == "" && *journal == "" && *cgroup == "" {
		return fmt.Errorf("enable at least one input")
	}
	q, err := openQueue(*state, *limit, src)
	if err != nil {
		return err
	}
	defer q.db.Close()
	g := grpc.NewServer(grpc.MaxRecvMsgSize(4 << 20))
	defer g.Stop()
	var listener net.Listener
	if *signals != "" {
		seen := map[string]bool{}
		for _, s := range strings.Split(*signals, ",") {
			if seen[s] {
				return fmt.Errorf("duplicate signal %q", s)
			}
			seen[s] = true
			switch s {
			case "traces":
				traces.RegisterTraceServiceServer(g, traceService{q: q})
			case "logs":
				logs.RegisterLogsServiceServer(g, logService{q: q})
			case "metrics":
				metrics.RegisterMetricsServiceServer(g, metricService{q: q})
			default:
				return fmt.Errorf("unknown signal %q", s)
			}
		}
		network, address := "tcp", *listen
		if path, ok := strings.CutPrefix(address, "unix://"); ok {
			network, address = "unix", path
		}
		listener, err = net.Listen(network, address)
		if err != nil {
			return err
		}
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if *usage != "" {
		stop, err := serveUsage(ctx, q, *usageSocket, *usageKey, *usage)
		if err != nil {
			return err
		}
		defer stop()
	}
	var wg sync.WaitGroup
	serveErr := make(chan error, 1)
	if listener != nil {
		wg.Go(func() { serveErr <- g.Serve(listener) })
	}
	delivery := newSender(*endpoint, *token, *socket)
	wg.Go(func() { delivery.run(ctx, q) })
	if *journal != "" {
		wg.Go(func() { followJournal(ctx, q, *journal) })
	}
	t := tailer{path: *logfile}
	defer t.close()
	if *logfile != "" {
		wg.Go(func() {
			periodic(ctx, 250*time.Millisecond, "stdout", func() error { return t.poll(q) })
		})
	}
	if *cgroup != "" {
		wg.Go(func() { periodic(ctx, *interval, "resources", func() error { return sample(*cgroup, q) }) })
	}
	select {
	case <-ctx.Done():
	case err = <-serveErr:
	}
	cancel()
	stopTimer := time.AfterFunc(3*time.Second, g.Stop)
	g.GracefulStop()
	stopTimer.Stop()
	wg.Wait()
	final, done := context.WithTimeout(context.Background(), *flush)
	defer done()
	t.final = true
	for final.Err() == nil {
		var tailErr error
		if *logfile != "" {
			tailErr = t.poll(q)
		}
		id, data, readErr := q.first()
		if readErr != nil {
			return readErr
		}
		if data == nil {
			if tailErr != nil {
				log.Printf("final stdout read: %v", tailErr)
			}
			break
		}
		if postErr := delivery.post(final, data); postErr != nil {
			log.Printf("pending batches retained: %v", postErr)
			break
		}
		if ackErr := q.ack(id); ackErr != nil {
			return ackErr
		}
	}
	return err
}

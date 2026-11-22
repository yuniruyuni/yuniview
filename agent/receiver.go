package main

import (
	"context"
	"errors"
	"time"

	logs "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	metrics "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	traces "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func (q *queue) accept(signal string, req proto.Message) error {
	data, err := protojson.Marshal(req)
	if err == nil {
		err = q.add(signal, data, nil)
	}
	return exportError(err)
}

func exportError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, errFull):
		return status.Error(codes.Unavailable, err.Error())
	case errors.Is(err, errLarge):
		return status.Error(codes.InvalidArgument, err.Error())
	default:
		return status.Error(codes.Internal, "cannot persist export")
	}
}

type traceService struct {
	traces.UnimplementedTraceServiceServer
	q *queue
}

func (s traceService) Export(_ context.Context, r *traces.ExportTraceServiceRequest) (*traces.ExportTraceServiceResponse, error) {
	return &traces.ExportTraceServiceResponse{}, s.q.accept("traces", r)
}

type logService struct {
	logs.UnimplementedLogsServiceServer
	q      *queue
	fields map[string]bool
}

func (s logService) Export(_ context.Context, r *logs.ExportLogsServiceRequest) (*logs.ExportLogsServiceResponse, error) {
	data, err := bufferLogExport(r, s.fields, time.Now())
	if err == nil {
		err = s.q.add("logs", data, nil)
	}
	return &logs.ExportLogsServiceResponse{}, exportError(err)
}

type metricService struct {
	metrics.UnimplementedMetricsServiceServer
	q *queue
}

func (s metricService) Export(_ context.Context, r *metrics.ExportMetricsServiceRequest) (*metrics.ExportMetricsServiceResponse, error) {
	return &metrics.ExportMetricsServiceResponse{}, s.q.accept("metrics", r)
}

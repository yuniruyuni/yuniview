package main

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"

	collector "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	common "go.opentelemetry.io/proto/otlp/common/v1"
	logs "go.opentelemetry.io/proto/otlp/logs/v1"
	resource "go.opentelemetry.io/proto/otlp/resource/v1"
)

func TestEventCountsAndAttributeMinimization(t *testing.T) {
	field := func(key, value string) *common.KeyValue {
		return &common.KeyValue{Key: key, Value: &common.AnyValue{Value: &common.AnyValue_StringValue{StringValue: value}}}
	}
	scope := &logs.ScopeLogs{Scope: &common.InstrumentationScope{Name: "yuniview.events"}}
	for i := 0; i < 101; i++ {
		action := "view"
		if i == 100 {
			action = "edit"
		}
		scope.LogRecords = append(scope.LogRecords, &logs.LogRecord{EventName: "open", Attributes: []*common.KeyValue{field("action", action), field("user", "secret-id")}, Body: field("body", "secret-body").Value})
	}
	req := &collector.ExportLogsServiceRequest{ResourceLogs: []*logs.ResourceLogs{
		{Resource: &resource.Resource{Attributes: []*common.KeyValue{field("resource", "secret-resource")}}, ScopeLogs: []*logs.ScopeLogs{scope}},
		{ScopeLogs: []*logs.ScopeLogs{{LogRecords: []*logs.LogRecord{{Body: field("body", "ordinary log").Value}}}}},
	}}
	raw, err := bufferLogExport(req, map[string]bool{"action": true}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		Events []eventCount `json:"bufferedEvents"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, event := range out.Events {
		counts[event.Attrs["action"]] += event.Count
	}
	if len(out.Events) != 2 || counts["edit"] != 1 || counts["view"] != 100 || bytes.Contains(raw, []byte("secret")) || !bytes.Contains(raw, []byte("ordinary log")) {
		t.Fatalf("unexpected export: %s", raw)
	}
}

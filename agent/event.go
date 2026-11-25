package main

import (
	"encoding/json"
	"sort"
	"time"

	logs "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	v1 "go.opentelemetry.io/proto/otlp/logs/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

// Only the explicit application event scope opts into aggregation. Ordinary
// logs keep their body and trace context. Event attributes must be opted in
// independently on the receiving agent.
type eventCount struct {
	At    time.Time         `json:"at"`
	Name  string            `json:"name"`
	Attrs map[string]string `json:"attrs"`
	Count int               `json:"count"`
}

func bufferLogExport(req *logs.ExportLogsServiceRequest, fields map[string]bool, now time.Time) ([]byte, error) {
	counts := map[string]*eventCount{}
	resources := req.ResourceLogs[:0]
	for _, resource := range req.ResourceLogs {
		scopes := resource.ScopeLogs[:0]
		for _, scope := range resource.ScopeLogs {
			if scope.GetScope().GetName() != "yuniview.events" {
				scopes = append(scopes, scope)
				continue
			}
			keep := make([]*v1.LogRecord, 0)
			for _, r := range scope.LogRecords {
				if r.EventName == "" {
					keep = append(keep, r)
					continue
				}
				at := now
				if r.TimeUnixNano != 0 {
					at = time.Unix(0, int64(r.TimeUnixNano))
				}
				e := eventCount{At: at.UTC().Truncate(time.Second), Name: r.EventName, Attrs: map[string]string{}}
				for _, attr := range r.Attributes {
					if fields[attr.Key] {
						// The application declares categorical dimensions as strings.
						if v := attr.GetValue().GetStringValue(); v != "" {
							e.Attrs[attr.Key] = v
						}
					}
				}
				k, err := json.Marshal(e)
				if err != nil {
					return nil, err
				}
				key := string(k)
				prev := counts[key]
				if prev == nil {
					prev = &e
					counts[key] = prev
				}
				prev.Count++
			}
			scope.LogRecords = keep
			if len(keep) > 0 {
				scopes = append(scopes, scope)
			}
		}
		resource.ScopeLogs = scopes
		if len(scopes) > 0 {
			resources = append(resources, resource)
		}
	}
	req.ResourceLogs = resources
	raw, err := protojson.Marshal(req)
	if err != nil || len(counts) == 0 {
		return raw, err
	}
	var out struct {
		Resources json.RawMessage `json:"resourceLogs,omitempty"`
		Events    []*eventCount   `json:"bufferedEvents"`
	}
	var original struct {
		Resources json.RawMessage `json:"resourceLogs"`
	}
	if err = json.Unmarshal(raw, &original); err != nil {
		return nil, err
	}
	out.Resources = original.Resources
	keys := make([]string, 0, len(counts))
	for key := range counts {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		out.Events = append(out.Events, counts[key])
	}
	return json.Marshal(out)
}

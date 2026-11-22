CREATE INDEX telemetry_pending ON telemetry_batches(received_at) WHERE NOT indexed;
GRANT UPDATE (indexed) ON telemetry_batches TO yuniview_app;
CREATE TABLE telemetry_events (
 source text NOT NULL, batch_id text NOT NULL, ordinal integer NOT NULL,
 workload text NOT NULL, instance text NOT NULL,
 at timestamptz NOT NULL, slot text NOT NULL, revision text NOT NULL,
 kind text NOT NULL, name text NOT NULL, body text NOT NULL, trace text NOT NULL,
 span text NOT NULL, parent text NOT NULL, value double precision, unit text NOT NULL,
 failed boolean NOT NULL, entry boolean NOT NULL, attrs json NOT NULL,
 PRIMARY KEY (source,batch_id,ordinal),
 FOREIGN KEY (source,batch_id) REFERENCES telemetry_batches(source_id,batch_id) ON DELETE CASCADE
);
CREATE INDEX events_kind_time ON telemetry_events(kind,at);
CREATE INDEX events_source_time ON telemetry_events(source,at);
CREATE INDEX events_trace ON telemetry_events(trace,at) WHERE trace <> '';
CREATE TABLE dashboards (id uuid PRIMARY KEY, definition jsonb NOT NULL);
CREATE TABLE monitors (
 id uuid PRIMARY KEY, definition jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending', evaluated timestamptz, value double precision
);
CREATE TABLE monitor_history (
 id uuid PRIMARY KEY, monitor_id uuid NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
 title text NOT NULL, state text NOT NULL, at timestamptz NOT NULL, value double precision,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 delivery text NOT NULL, retry_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX history_delivery ON monitor_history(delivery,retry_at);
GRANT SELECT,INSERT ON telemetry_events TO yuniview_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON dashboards,monitors,monitor_history TO yuniview_app;
GRANT DELETE ON telemetry_batches TO yuniview_app;
CREATE INDEX batches_received_at ON telemetry_batches(received_at);

CREATE TABLE daily_visitors (
 day date NOT NULL,
 source text NOT NULL REFERENCES sources(id),
 kind text NOT NULL CHECK (kind IN ('account', 'browser')),
 digest text NOT NULL,
 PRIMARY KEY (day, source, kind, digest)
);
GRANT SELECT, INSERT, DELETE ON daily_visitors TO yuniview_app;

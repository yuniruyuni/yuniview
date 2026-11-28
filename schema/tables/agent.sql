CREATE TABLE agent_credentials (
    token_sha256 text PRIMARY KEY,
    source_id text NOT NULL REFERENCES sources(id),
    workload text NOT NULL,
    slot text NOT NULL DEFAULT ''
);
GRANT SELECT ON agent_credentials TO yuniview_app;

CREATE TABLE telemetry_batches (
    source_id text NOT NULL REFERENCES sources(id),
    batch_id text NOT NULL,
    workload text NOT NULL,
    instance text NOT NULL,
    slot text NOT NULL,
    revision text NOT NULL,
    signal text NOT NULL,
    observed_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    payload json,  -- null once dropped, some days after indexing
    indexed boolean NOT NULL DEFAULT false,
    PRIMARY KEY (source_id, batch_id)
);
CREATE INDEX telemetry_batches_source_time ON telemetry_batches (source_id, observed_at);
GRANT SELECT, INSERT ON telemetry_batches TO yuniview_app;

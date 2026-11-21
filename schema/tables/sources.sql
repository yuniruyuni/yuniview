CREATE TABLE sources (
    id text PRIMARY KEY,
    registered_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON sources TO yuniview_app;

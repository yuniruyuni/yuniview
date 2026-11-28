#!/usr/bin/env bash
# Test the built client and actual application against a disposable database.
set -euo pipefail
cd "$(dirname "$0")/.."
pg=$(docker run -d -p 127.0.0.1::5432 -e POSTGRES_PASSWORD=test postgres:17)
app=""
cleanup(){ if [[ -n "$app" ]];then kill "$app" 2>/dev/null || true;wait "$app" || true;fi;docker rm -fv "$pg" >/dev/null; }
trap cleanup EXIT
for _ in {1..60};do docker exec "$pg" pg_isready -h 127.0.0.1 -U postgres >/dev/null && break;sleep 1;done
psql(){ docker exec -i "$pg" psql -v ON_ERROR_STOP=1 -U postgres "$@"; }
psql < bin/init-dev.sql
for f in schema/tables/{sources,agent,console}.sql;do psql < "$f";done
export CONSOLE_TOKEN=$(openssl rand -hex 32)
digest=$(printf '%s' "$CONSOLE_TOKEN" | sha256sum | cut -d' ' -f1)
psql -c "INSERT INTO sources(id) VALUES ('checkout'); INSERT INTO agent_credentials VALUES ('$digest','checkout','app','blue');"
psql -c "INSERT INTO telemetry_batches(source_id,batch_id,workload,instance,slot,revision,signal,observed_at,payload) VALUES ('checkout','old','app','prior','green','v0','stdout',now(),'[\"previous deployment\"]');"
# Received long ago, so the worker drops its payload once it is indexed.
psql -c "INSERT INTO telemetry_batches(source_id,batch_id,workload,instance,slot,revision,signal,observed_at,received_at,payload) VALUES ('checkout','expired','app','expired-test','blue','v0','stdout',now()-interval '2 minutes',now()-interval '30 days','[\"expired payload line\"]');"
export GREEN_TEST_TOKEN=$(openssl rand -hex 32)
green_digest=$(printf '%s' "$GREEN_TEST_TOKEN" | sha256sum | cut -d' ' -f1)
psql -c "INSERT INTO agent_credentials VALUES ('$green_digest','checkout','app','green');"
ports=$(python3 -c 'import socket; ss=[socket.socket() for _ in range(3)];[s.bind(("127.0.0.1",0)) for s in ss];print(*(s.getsockname()[1] for s in ss))')
read -r PORT HOOK_PORT INGEST_PORT <<< "$ports"
export PORT HOOK_PORT INGEST_PORT YUNIVIEW_ADMIN_AUTH=local CONSOLE_URL="http://127.0.0.1:$PORT" MONITOR_WEBHOOK_URL="http://127.0.0.1:$HOOK_PORT/"
export PGHOST=127.0.0.1 PGPORT=$(docker port "$pg" 5432/tcp | cut -d: -f2) DB_NAME=postgres DB_USER=yuniview_app DB_PASSWORD=yuniview_dev STATIC_DIR=client/static
bun run build
./server/dist/server & app=$!
for _ in {1..40};do curl -fsS "$CONSOLE_URL/health" >/dev/null 2>&1 && break;sleep .25;done
[[ $(curl -s -o /dev/null -w '%{http_code}' -X POST "$CONSOLE_URL/api/agent/v1/batches") == 404 ]]
[[ $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$INGEST_PORT/api/trpc/library") == 404 ]]
(cd e2e && bun x playwright test --config console.config.ts)
[[ $(psql -Atc "SELECT count(*) FROM telemetry_events WHERE body='previous deployment'") == 1 ]]
# Each distinct resource is stored once, and rows refer to it instead of carrying it.
[[ $(psql -Atc "SELECT count(*) FROM telemetry_resources") == 1 ]]
[[ $(psql -Atc "SELECT count(*) FROM telemetry_events WHERE resource IS NOT NULL") -ge 1 ]]
[[ $(psql -Atc "SELECT count(*) FROM telemetry_events WHERE attrs::jsonb ? 'resource'") == 0 ]]
# The retention rule took the old container samples together with their batch, and left the rest.
[[ $(psql -Atc "SELECT count(*) FROM telemetry_batches WHERE instance='retention-test'") == 3 ]]
[[ $(psql -Atc "SELECT count(*) FROM retention_rules") == 0 ]]
# The old batch kept its row and lost only its payload; recent batches keep theirs.
[[ $(psql -Atc "SELECT count(*) FROM telemetry_batches WHERE batch_id='expired' AND payload IS NULL AND indexed") == 1 ]]
[[ $(psql -Atc "SELECT count(*) FROM telemetry_events WHERE body='expired payload line'") == 1 ]]
[[ $(psql -Atc "SELECT count(*) FROM telemetry_batches WHERE payload IS NULL AND received_at > now()-interval '7 days'") == 0 ]]

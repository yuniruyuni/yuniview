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
ports=$(python3 -c 'import socket; a,b=socket.socket(),socket.socket();a.bind(("127.0.0.1",0));b.bind(("127.0.0.1",0));print(a.getsockname()[1],b.getsockname()[1])')
read -r PORT HOOK_PORT <<< "$ports"
export PORT HOOK_PORT CONSOLE_URL="http://127.0.0.1:$PORT" MONITOR_WEBHOOK_URL="http://127.0.0.1:$HOOK_PORT/"
export PGHOST=127.0.0.1 PGPORT=$(docker port "$pg" 5432/tcp | cut -d: -f2) DB_NAME=postgres DB_USER=yuniview_app DB_PASSWORD=yuniview_dev STATIC_DIR=client/static
bun run build
./server/dist/server & app=$!
for _ in {1..40};do curl -fsS "$CONSOLE_URL/health" >/dev/null 2>&1 && break;sleep .25;done
(cd e2e && bun x playwright test --config console.config.ts)
[[ $(psql -Atc "SELECT count(*) FROM telemetry_events WHERE body='previous deployment'") == 1 ]]

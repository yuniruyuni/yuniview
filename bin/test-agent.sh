#!/usr/bin/env bash
# End-to-end check against a disposable PostgreSQL database.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
pg=""
server=""
agent=""
cleanup() {
  if [[ -n "$agent" ]]; then kill "$agent" 2>/dev/null || true; wait "$agent" || true; fi
  if [[ -n "$server" ]]; then kill "$server" 2>/dev/null || true; wait "$server" || true; fi
  if [[ -n "$pg" ]]; then docker rm -fv "$pg" >/dev/null; fi
  rm -rf "$tmp"
}
trap cleanup EXIT
pg=$(docker run -d -p 127.0.0.1::5432 -e POSTGRES_PASSWORD=localtest postgres:17)
sql() { docker exec -i "$pg" psql -X -v ON_ERROR_STOP=1 -At -U postgres "$@"; }
for _ in {1..60}; do docker exec "$pg" pg_isready -h 127.0.0.1 -U postgres >/dev/null && break; sleep 1; done
sql < bin/init-dev.sql
sql < schema/tables/sources.sql
sql < schema/tables/agent.sql
sql < schema/tables/console.sql
token=$(openssl rand -hex 32)
printf '%s' "$token" > "$tmp/token"
digest=$(sha256sum "$tmp/token" | cut -d' ' -f1)
sql -c "INSERT INTO sources(id) VALUES ('demo'); INSERT INTO agent_credentials VALUES ('$digest','demo','app','blue');"
free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])'; }
port=$(free_port)
grpc=$(free_port)
export INGEST_PORT=$(free_port)
url="http://127.0.0.1:$INGEST_PORT/api/agent/v1/batches"
export PGPORT=$(docker port "$pg" 5432/tcp | cut -d: -f2)
export PGHOST=127.0.0.1 DB_NAME=postgres DB_USER=yuniview_app DB_PASSWORD=yuniview_dev PORT="$port"
(cd agent && go build -o "$tmp/agent" .)
printf 'hello log\n' > "$tmp/stdout"
printf 'usage_usec 123\n' > "$tmp/cpu.stat"
printf '456\n' > "$tmp/memory.current"
start_agent() {
 "$tmp/agent" -service demo -slot blue -instance first -state "$tmp/state" -endpoint "$url" -token-file "$tmp/token" -listen "127.0.0.1:$grpc" -log-file "$tmp/stdout" -cgroup "$tmp" -batch-interval 2s >"$tmp/agent.log" 2>&1 &
 agent=$!
}
start_agent
(cd agent && YUNIVIEW_TEST_GRPC="127.0.0.1:$grpc" go test -count=1 -run '^TestLiveExport$')
kill "$agent"; wait "$agent"; agent=""
bun server/src/index.ts >"$tmp/server.log" 2>&1 &
server=$!
start_agent
for _ in {1..60}; do
 if [[ $(sql -c "SELECT count(DISTINCT signal) FROM telemetry_batches") == 5 ]]; then break; fi
 sleep 1
done
[[ $(sql -c "SELECT count(DISTINCT signal) FROM telemetry_batches") == 5 ]] || { cat "$tmp/agent.log" "$tmp/server.log"; exit 1; }
[[ $(sql -c "SELECT count(*) FROM telemetry_batches WHERE payload::text LIKE '%checkout%'") == 1 ]]
for value in 'hello log' 'otlp message' 'cart.items'; do
  [[ $(sql -c "SELECT count(*) FROM telemetry_batches WHERE payload::text LIKE '%$value%'") == 1 ]]
done
# Held deliveries go out together: cgroup samples as one list, each with its time.
[[ $(sql -c "SELECT count(*) FROM telemetry_batches WHERE signal='resources' AND payload::jsonb ? 'samples'") -ge 1 ]]
body='{"id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","source":{"service":"demo","workload":"app","slot":"blue","instance":"x"},"signal":"stdout","time":"2026-01-01T00:00:00Z","payload":["duplicate"]}'
post() { curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $1" -H 'Content-Type: application/json' --data "$2" "$url"; }
[[ $(post bad "$body") == 401 ]]
[[ $(post "$token" "${body/blue/green}") == 403 ]]
[[ $(post "$token" "$body") == 204 ]]
[[ $(post "$token" "$body") == 204 ]]
[[ $(sql -c "SELECT count(*) FROM telemetry_batches WHERE batch_id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'") == 1 ]]
echo "All five signals stored, offline queue recovered, credentials and duplicate delivery verified."

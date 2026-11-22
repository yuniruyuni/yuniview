#!/bin/sh
set -eu
export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="$DB_USER"
# secret の値に末尾改行が乗ることがあり、libpq は trim しないので落とす。
export PGPASSWORD="$(printf '%s' "$DB_PASSWORD")"
export PGDATABASE="$DB_NAME"

# plan phase の向き先を対象 DB 自身にする。
#
# 渡さないと pgschema は desired state の検証用に **埋め込み PostgreSQL を起動**
# する。その実体は repo1.maven.org から 15 MB の jar を取る HTTP GET 1 回で、
# リトライが無く 200 以外はすべて "no version found matching <version>" になる。
# バージョンが無いという意味ではなく取得に失敗したという意味しかないので、
# 落ちたときに原因が分かりにくい。
#
# apply は「対象 DB とローカル schema の差分」を見るだけなので、比較用の
# スキーマは対象 DB 内で足りる。
export PGSCHEMA_PLAN_HOST="$PGHOST"
export PGSCHEMA_PLAN_PORT="$PGPORT"
export PGSCHEMA_PLAN_USER="$PGUSER"
export PGSCHEMA_PLAN_PASSWORD="$PGPASSWORD"
export PGSCHEMA_PLAN_DB="$PGDATABASE"

# Wait for DB
for i in $(seq 1 30); do
  pg_isready -q 2>/dev/null && break
  [ "$i" -eq 30 ] && { echo "ERROR: DB not reachable after 30s" >&2; exit 1; }
  sleep 1
done

# pgschema natively supports \i directives for modular schema files
pgschema apply --file /app/schema/main.sql --auto-approve
# Upgrade only saved panels that used the two former built-in measures.
psql -X -v ON_ERROR_STOP=1 <<'SQL'
UPDATE dashboards d
SET definition = jsonb_set(definition, '{panels}', (
  SELECT jsonb_agg(CASE WHEN p->>'measure' IN ('accounts','browsers') THEN
    p || jsonb_build_object('measure','distinct','distinct',jsonb_build_object(
      'dataset','daily','field',CASE p->>'measure' WHEN 'accounts' THEN 'visit.account' ELSE 'visit.browser' END))
    ELSE p END ORDER BY n)
  FROM jsonb_array_elements(d.definition->'panels') WITH ORDINALITY AS items(p,n)
))
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(d.definition->'panels') p WHERE p->>'measure' IN ('accounts','browsers'));
SQL
echo "Migration complete."

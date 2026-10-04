#!/usr/bin/env bash
# Temporary investigation only. No linked/remote Supabase, no product mutation.
set -euo pipefail
OUT=/tmp/f23c1-types-probe
mkdir -p "$OUT"
CONTAINER="simbionte-types-probe-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
cleanup() {
  docker rm -fv "$CONTAINER" > "$OUT/teardown.log" 2>&1 || true
  if docker inspect "$CONTAINER" >/dev/null 2>&1; then
    echo 'TEARDOWN FAILED' | tee -a "$OUT/teardown.log"
    return 1
  fi
  echo 'Container and anonymous volumes removed' | tee -a "$OUT/teardown.log"
}
trap cleanup EXIT
test "$(git rev-parse HEAD:supabase/baseline.sql)" = "$(git rev-parse 6371b4ede1a624c5ba8586b24f94abaf70b3fd03:supabase/baseline.sql)"
git rev-parse HEAD > "$OUT/probe-commit.txt"
git rev-parse 6371b4ede1a624c5ba8586b24f94abaf70b3fd03:supabase/baseline.sql > "$OUT/baseline-blob.txt"
uname -a > "$OUT/environment.txt"
node --version >> "$OUT/environment.txt"
pnpm --version >> "$OUT/environment.txt"
# Fixed stable release, verified using its published checksums.
CLI_VERSION=2.119.0
ARCHIVE="supabase_${CLI_VERSION}_linux_amd64.tar.gz"
curl --retry 3 -fsSL "https://github.com/supabase/cli/releases/download/v${CLI_VERSION}/$ARCHIVE" -o "/tmp/$ARCHIVE"
curl --retry 3 -fsSL "https://github.com/supabase/cli/releases/download/v${CLI_VERSION}/checksums.txt" -o /tmp/supabase-checksums.txt
(cd /tmp && grep " $ARCHIVE$" supabase-checksums.txt | sha256sum -c -) | tee "$OUT/cli-checksum.txt"
mkdir -p /tmp/f23c1-cli
tar -xzf "/tmp/$ARCHIVE" -C /tmp/f23c1-cli
CLI=/tmp/f23c1-cli/supabase
"$CLI" --version | tee "$OUT/cli-version.txt"
test "$("$CLI" --version)" = "$CLI_VERSION"
"$CLI" --help > "$OUT/cli-help.txt"
"$CLI" gen --help > "$OUT/cli-gen-help.txt"
"$CLI" gen types --help > "$OUT/cli-types-help.txt"
curl --retry 3 -fsSL https://supabase.com/changelog.md -o "$OUT/supabase-changelog.md"
# Reuse the exact prelude rather than maintaining another stub implementation.
node <<'JS'
const fs = require('node:fs');
const harness = fs.readFileSync('scripts/test-db.sh', 'utf8');
const start = harness.indexOf('echo "==> prelude: stubs mínimos');
if (start < 0) throw new Error('Canonical prelude marker missing');
const match = harness.slice(start).match(/psql_install <<'SQL'\r?\n([\s\S]*?)\r?\nSQL/);
if (!match) throw new Error('Canonical prelude heredoc missing');
fs.writeFileSync('/tmp/f23c1-types-probe/prelude.sql', match[1] + '\n');
JS
docker run -d --rm --name "$CONTAINER" -p '127.0.0.1::5432' \
  --label simbionte.probe=f23c1 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres pgvector/pgvector:pg15
docker image inspect pgvector/pgvector:pg15 --format '{{json .RepoDigests}}' > "$OUT/pg-image-digests.txt"
PORT="$(docker port "$CONTAINER" 5432/tcp | head -1 | sed 's/.*://')"
ready=0
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" psql -h 127.0.0.1 -U postgres -d postgres -c 'select 1' >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
test "$ready" = 1
docker exec "$CONTAINER" psql -U postgres -Atc 'select version()' > "$OUT/postgres-version.txt"
for DB in probe_a probe_b; do
  docker exec "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -c "create database $DB"
  docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f - < "$OUT/prelude.sql" > "$OUT/$DB-prelude.log" 2>&1
  docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f - < supabase/baseline.sql > "$OUT/$DB-baseline.log" 2>&1
  docker exec "$CONTAINER" psql -U postgres -d "$DB" -At -v ON_ERROR_STOP=1 -c "select table_name || '.' || column_name || ':' || data_type || ':' || is_nullable from information_schema.columns where table_schema='public' and table_name in ('business_profile_installations','business_profile_contributions','business_profile_operations') order by table_name,ordinal_position" > "$OUT/$DB-business-profile-columns.txt"
  TABLES="$(docker exec "$CONTAINER" psql -U postgres -d "$DB" -At -c "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name in ('business_profile_installations','business_profile_contributions','business_profile_operations')")"
  test "$TABLES" = 3 || { echo BASELINE_TYPE_SOURCE_GAP; exit 1; }
  # Credentials are synthetic and only reach this disposable loopback database.
  "$CLI" gen types typescript --db-url "postgresql://postgres:postgres@127.0.0.1:$PORT/$DB" --schema public > "$OUT/database.types.$DB.ts" 2> "$OUT/$DB-generation.log"
  test -s "$OUT/database.types.$DB.ts"
done
cp lib/database.types.ts "$OUT/database.types.current.ts"
sha256sum "$OUT"/database.types.*.ts | tee "$OUT/hashes.txt"
cmp "$OUT/database.types.probe_a.ts" "$OUT/database.types.probe_b.ts"
node .probe/f23c1/compare.cjs "$OUT"
git diff --exit-code -- lib/database.types.ts supabase/baseline.sql package.json pnpm-lock.yaml

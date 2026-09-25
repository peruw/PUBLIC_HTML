#!/usr/bin/env bash
# Testes do banco do portal /professores/ (sem Docker).
# Sobe um Postgres temporário, aplica: shim do Supabase → migrações → seed → asserções RLS.
# Uso: bash scripts/test-db.sh   (ou npm run test:db)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n 1)}"
if [ -z "$PGBIN" ] || [ ! -x "$PGBIN/initdb" ]; then
  echo "PostgreSQL não encontrado (defina PGBIN=/caminho/para/bin)" >&2
  exit 2
fi

# initdb/pg_ctl não rodam como root: usa o usuário do sistema "postgres"
as_pg() {
  if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi
}

D="$(mktemp -d "${TMPDIR:-/tmp}/profdb.XXXXXX")"
[ "$(id -u)" = 0 ] && chown postgres "$D"

cleanup() {
  as_pg "$PGBIN/pg_ctl" -D "$D/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$D"
}
trap cleanup EXIT

# Porta livre aleatória (o socket fica em $D; sem TCP)
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
PORT=""
for _ in $(seq 1 50); do
  cand=$(( 20000 + RANDOM % 40000 ))
  if ! port_in_use "$cand"; then PORT=$cand; break; fi
done
[ -n "$PORT" ] || { echo "Sem porta livre" >&2; exit 2; }

LOCALE=C.UTF-8
locale -a 2>/dev/null | grep -qi '^c\.utf-\?8$' || LOCALE=C

echo "==> Postgres temporário em $D (porta $PORT, $("$PGBIN/postgres" --version))"
as_pg "$PGBIN/initdb" -D "$D/data" -A trust -U postgres -E UTF8 --locale="$LOCALE" >/dev/null
if ! as_pg "$PGBIN/pg_ctl" -D "$D/data" -l "$D/server.log" -w \
     -o "-p $PORT -k $D -c listen_addresses='' -c fsync=off -c wal_level=logical" start >/dev/null; then
  cat "$D/server.log" >&2
  exit 2
fi

# Migrações ficam silenciosas; os testes reativam NOTICE para listar as asserções
export PGOPTIONS="-c client_min_messages=warning"
PSQL=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$D" -p "$PORT" -U postgres -d postgres)

run_sql() {
  echo "==> $1"
  # tira o prefixo "psql:arquivo:linha: NOTICE:" das asserções (erros ficam completos)
  if ! "${PSQL[@]}" -f "$ROOT/$1" 2>&1 | sed -E 's/^psql:[^ ]+ NOTICE:  /   /'; then
    echo "FALHOU em $1" >&2
    exit 1
  fi
}

run_sql supabase/tests/00_shim.sql
for f in "$ROOT"/supabase/migrations/*.sql; do
  run_sql "supabase/migrations/$(basename "$f")"
done
run_sql supabase/seed.sql
for f in "$ROOT"/supabase/tests/[1-9]*.sql; do
  run_sql "supabase/tests/$(basename "$f")"
done

echo "OK: banco do portal /professores/ passou em todos os testes."

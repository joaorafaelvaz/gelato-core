#!/bin/bash
# Cria o role de RUNTIME (gelato_app) com a senha vinda do ambiente (.env.prod).
# gelato_owner (POSTGRES_USER) é o dono do schema e roda as migrações; gelato_app
# nunca recebe UPDATE/DELETE nas tabelas append-only (migrações cuidam disso).
set -euo pipefail
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<-EOSQL
	CREATE ROLE gelato_app LOGIN PASSWORD '${APP_DB_PASSWORD}';
	GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO gelato_app;
	GRANT USAGE ON SCHEMA public TO gelato_app;
EOSQL

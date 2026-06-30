#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: restore.sh <backup.sql.gz> [container]"
  exit 1
fi

BACKUP_FILE="$1"
CONTAINER="${2:-gelato-postgres}"

POSTGRES_USER="${POSTGRES_USER:-gelato}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-gelato_password}"
POSTGRES_DB="${POSTGRES_DB:-gelatocore}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "Restoring $POSTGRES_DB from $BACKUP_FILE..."
gunzip < "$BACKUP_FILE" | PGPASSWORD="$POSTGRES_PASSWORD" docker exec -i "$CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

echo "Restore complete."

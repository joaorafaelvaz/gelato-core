#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_DIR="$PROJECT_DIR/docker/backups"

POSTGRES_USER="${POSTGRES_USER:-gelato}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-gelato_password}"
POSTGRES_DB="${POSTGRES_DB:-gelatocore}"
CONTAINER="${1:-gelato-postgres}"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/gelatocore-$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "Backing up $POSTGRES_DB from $CONTAINER to $BACKUP_FILE..."
PGPASSWORD="$POSTGRES_PASSWORD" docker exec -i "$CONTAINER" pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$BACKUP_FILE"

echo "Backup created: $BACKUP_FILE"

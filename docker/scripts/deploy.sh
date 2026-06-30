#!/usr/bin/env bash
# One-command production deploy from the VPS
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_DIR"

echo "Pulling latest code..."
git pull origin main || true

echo "Building and starting services..."
cd docker
docker compose pull || true
docker compose up -d --build

echo "Waiting for postgres to be healthy..."
docker compose exec postgres pg_isready -U "${POSTGRES_USER:-gelato}" -d "${POSTGRES_DB:-gelatocore}"

echo "Running database migrations..."
./scripts/migrate.sh gelato-api

echo "Seeding if needed..."
docker exec gelato-api sh -c "cd /app && npx tsx prisma/seed.ts" || true

echo "Deployment complete."
echo "BackOffice: https://${DOMAIN:-gelato.example.com}"

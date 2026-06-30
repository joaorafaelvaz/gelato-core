#!/usr/bin/env bash
# Run migrations in the running API container
set -euo pipefail

CONTAINER="${1:-gelato-api}"
docker exec "$CONTAINER" sh -c "cd /app && npx prisma migrate deploy"

#!/usr/bin/env bash
# Smoke test for local/CI Docker Compose stack
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../.."

echo "=== gelato-core deploy smoke test ==="

cd docker

echo "Building stack..."
docker compose -f docker-compose.yml up -d --build

echo "Waiting for services..."
sleep 10

echo "Checking API health..."
curl -fsS http://127.0.0.1:4000/health || { echo "API health check failed"; exit 1; }

echo "Checking BackOffice (nginx)..."
curl -fsS -o /dev/null http://127.0.0.1/ || { echo "BackOffice check failed"; exit 1; }

echo "Checking API via nginx proxy..."
curl -fsS http://127.0.0.1/api/health || { echo "Nginx proxy check failed"; exit 1; }

echo "Smoke test passed."

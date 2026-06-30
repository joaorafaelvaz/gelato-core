#!/usr/bin/env bash
# ============================================================
# gelato-core — VPS Deploy Script
# Usage: ./deploy.sh [stage]
#   stage = "setup"  → first-time provisioning (installs Docker, etc.)
#   stage = "deploy" → build + migrate + restart (default)
#   stage = "rollback" → restore previous image + restart
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCKER_DIR="$PROJECT_DIR/docker"
STAGE="${1:-deploy}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
err()  { echo -e "${RED}[error]${NC} $*" >&2; }

# ============================================================
# SETUP — first-time VPS provisioning
# ============================================================
setup() {
  log "Stage: SETUP — provisioning VPS"

  # Check OS
  if [[ -f /etc/os-release ]]; then
    source /etc/os-release
    log "OS: $PRETTY_NAME"
  else
    warn "Could not detect OS. Assuming Debian/Ubuntu."
  fi

  # Update system
  log "Updating system packages..."
  apt-get update -qq && apt-get upgrade -y -qq

  # Install prerequisites
  log "Installing prerequisites..."
  apt-get install -y -qq \
    curl git ufw ca-certificates gnupg lsb-release \
    openssl cron jq

  # Install Docker
  if ! command -v docker &>/dev/null; then
    log "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
  else
    log "Docker already installed: $(docker --version)"
  fi

  # Install Docker Compose plugin
  if ! docker compose version &>/dev/null; then
    log "Installing Docker Compose plugin..."
    apt-get install -y -qq docker-compose-plugin
  fi

  # Configure firewall
  log "Configuring firewall (ufw)..."
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp    # SSH
  ufw allow 80/tcp    # HTTP
  ufw allow 443/tcp   # HTTPS
  ufw --force enable

  # Create app directory
  APP_DIR="/opt/gelato-core"
  if [[ ! -d "$APP_DIR" ]]; then
    log "Creating $APP_DIR..."
    mkdir -p "$APP_DIR"
  fi

  # Create docker network
  docker network create gelato-network 2>/dev/null || true

  # Setup swap (if < 4GB RAM)
  TOTAL_MEM=$(free -m | awk '/^Mem:/{print $2}')
  if [[ $TOTAL_MEM -lt 4096 ]]; then
    if [[ ! -f /swapfile ]]; then
      log "Creating 2GB swap file..."
      fallocate -l 2G /swapfile
      chmod 600 /swapfile
      mkswap /swapfile
      swapon /swapfile
      echo '/swapfile none swap sw 0 0' >> /etc/fstab
      log "Swap enabled."
    else
      log "Swap file already exists."
    fi
  fi

  # Setup log rotation
  cat > /etc/logrotate.d/gelato-core <<EOF
/opt/gelato-core/docker/logs/*.log {
  daily
  rotate 14
  compress
  delaycompress
  missingok
  notifempty
  create 0644 root root
}
EOF

  log "Setup complete. Next steps:"
  log "  1. Clone the repo to $APP_DIR"
  log "  2. Copy .env: cp docker/.env.example docker/.env && nano docker/.env"
  log "  3. Get SSL certs (if using HTTPS):"
  log "     certbot certonly --standalone -d your-domain.com"
  log "     cp /etc/letsencrypt/live/your-domain.com/*.pem docker/nginx/ssl/"
  log "  4. Run: ./deploy.sh deploy"
}

# ============================================================
# DEPLOY — build + migrate + restart
# ============================================================
deploy() {
  log "Stage: DEPLOY — building and starting stack"

  cd "$DOCKER_DIR"

  # Check .env exists
  if [[ ! -f .env ]]; then
    err ".env file not found in docker/. Copy .env.example and configure it."
    exit 1
  fi

  # Load .env
  set -a
  source .env
  set +a

  # Validate critical env vars
  if [[ -z "$JWT_SECRET" || "$JWT_SECRET" == "change-me-in-production" ]]; then
    err "JWT_SECRET must be set to a strong value in .env"
    exit 1
  fi
  if [[ -z "$POSTGRES_PASSWORD" || "$POSTGRES_PASSWORD" == "gelato_password" ]]; then
    err "POSTGRES_PASSWORD must be changed from default in .env"
    exit 1
  fi

  # Pull latest code if git repo
  if [[ -d "$PROJECT_DIR/.git" ]]; then
    log "Pulling latest code..."
    cd "$PROJECT_DIR"
    git pull --ff-only origin main || warn "git pull failed, continuing with current code"
    cd "$DOCKER_DIR"
  fi

  # Tag current image as rollback target
  if docker image inspect docker-api:latest &>/dev/null; then
    log "Tagging current API image as rollback..."
    docker tag docker-api:latest docker-api:rollback 2>/dev/null || true
  fi

  # Build images
  log "Building Docker images..."
  docker compose -f docker-compose.yml build --pull api backoffice

  # Start services (without nginx for local dev)
  log "Starting services..."
  docker compose -f docker-compose.yml up -d

  # Wait for postgres
  log "Waiting for PostgreSQL to be healthy..."
  for i in $(seq 1 30); do
    if docker exec gelato-postgres pg_isready -U "${POSTGRES_USER:-gelato}" -d "${POSTGRES_DB:-gelatocore}" &>/dev/null; then
      log "PostgreSQL is ready."
      break
    fi
    sleep 1
    [[ $i -eq 30 ]] && { err "PostgreSQL did not become ready in 30s"; exit 1; }
  done

  # Wait for API
  log "Waiting for API to start..."
  for i in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${API_PORT:-4000}/api/health" &>/dev/null; then
      log "API is ready."
      break
    fi
    sleep 1
    [[ $i -eq 30 ]] && { err "API did not become ready in 30s"; exit 1; }
  done

  # Run migrations
  log "Running database migrations..."
  docker exec gelato-api sh -c "cd /app/apps/api && ./node_modules/.bin/prisma migrate deploy"

  # Seed (idempotent — upserts)
  log "Seeding database (idempotent)..."
  docker exec gelato-api sh -c "cd /app/apps/api && ./node_modules/.bin/tsx prisma/seed.ts" || warn "Seed may have already run"

  # Run E2E smoke tests
  log "Running E2E smoke tests..."
  if docker exec gelato-api sh -c "cd /app/apps/api && ./node_modules/.bin/tsx test/e2e-stack.ts" 2>&1; then
    log "E2E smoke tests PASSED."
  else
    warn "E2E smoke tests failed. Check logs."
  fi

  # Setup backup cron
  setup_backup_cron

  # Show status
  log "Deployment status:"
  docker compose -f docker-compose.yml ps

  echo ""
  log "=== DEPLOYMENT COMPLETE ==="
  log "API:          http://$(hostname -I | awk '{print $1}'):${API_PORT:-4000}/api"
  log "BackOffice:   http://$(hostname -I | awk '{print $1}'):${BACKOFFICE_PORT:-3000}"
  log "Health:       curl http://localhost:${API_PORT:-4000}/api/health"
  log "Metrics:      curl http://localhost:${API_PORT:-4000}/api/metrics"
  log ""
  log "Default login: admin@demo.de / admin123 (tenant: demo)"
  log "IMPORTANT: Change admin password and JWT_SECRET in production!"
}

# ============================================================
# ROLLBACK — restore previous image
# ============================================================
rollback() {
  log "Stage: ROLLBACK — restoring previous image"

  cd "$DOCKER_DIR"

  if ! docker image inspect docker-api:rollback &>/dev/null; then
    err "No rollback image found (docker-api:rollback). Cannot rollback."
    exit 1
  fi

  log "Tagging rollback image as latest..."
  docker tag docker-api:rollback docker-api:latest

  log "Restarting API with rollback image..."
  docker compose -f docker-compose.yml up -d --no-deps --force-recreate api

  log "Waiting for API to start..."
  for i in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${API_PORT:-4000}/api/health" &>/dev/null; then
      log "API is ready (rollback)."
      break
    fi
    sleep 1
    [[ $i -eq 30 ]] && { err "API did not become ready after rollback"; exit 1; }
  done

  log "Rollback complete."
}

# ============================================================
# Backup cron setup
# ============================================================
setup_backup_cron() {
  log "Setting up backup cron job (daily at 02:00)..."

  CRON_CMD="0 2 * * * cd $DOCKER_DIR && PGPASSWORD=${POSTGRES_PASSWORD:-gelato_password} docker exec gelato-postgres pg_dump -U ${POSTGRES_USER:-gelato} ${POSTGRES_DB:-gelatocore} | gzip > backups/gelatocore-\$(date +\%Y\%m\%d-\%H\%M\%S).sql.gz && find backups/ -name 'gelatocore-*.sql.gz' -mtime +${BACKUP_RETENTION_DAYS:-7} -delete"

  # Remove existing gelato backup cron
  ( crontab -l 2>/dev/null | grep -v 'gelatocore' ; echo "$CRON_CMD" ) | crontab -

  # Create backups directory
  mkdir -p "$DOCKER_DIR/backups"

  log "Backup cron configured (retention: ${BACKUP_RETENTION_DAYS:-7} days)."
}

# ============================================================
# MAIN
# ============================================================
case "$STAGE" in
  setup)
    setup
    ;;
  deploy)
    deploy
    ;;
  rollback)
    rollback
    ;;
  *)
    err "Unknown stage: $STAGE"
    echo "Usage: $0 [setup|deploy|rollback]"
    echo ""
    echo "Stages:"
    echo "  setup    — First-time VPS provisioning (installs Docker, ufw, swap)"
    echo "  deploy   — Build images, run migrations, start services (default)"
    echo "  rollback — Restore previous API image and restart"
    exit 1
    ;;
esac
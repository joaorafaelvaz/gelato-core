# VPS Deploy Guide

## Prerequisites

- VPS with Ubuntu/Debian (recommended 4GB RAM, 2 vCPU, 40GB SSD)
- SSH root or sudo access
- Domain pointing to the VPS IP (for HTTPS)

## Step 1 — First-time setup

SSH into your VPS and run:

```bash
# Clone the repo
git clone https://github.com/your-org/gelato-core.git /opt/gelato-core
cd /opt/gelato-core/docker/scripts

# Make scripts executable
chmod +x *.sh

# Run first-time provisioning (installs Docker, ufw, swap, log rotation)
./deploy.sh setup
```

This will:
- Update system packages
- Install Docker + Docker Compose
- Configure UFW firewall (allow SSH/HTTP/HTTPS only)
- Create 2GB swap if RAM < 4GB
- Set up log rotation for gelato-core logs

## Step 2 — Configure environment

```bash
cd /opt/gelato-core/docker

# Copy and edit .env
cp .env.example .env
nano .env
```

**Critical settings to change:**

```ini
# Use a strong password (min 32 chars)
POSTGRES_PASSWORD=<generate-a-strong-password>

# Use a strong JWT secret (min 32 chars)
JWT_SECRET=<generate-a-strong-jwt-secret>

# Your domain
DOMAIN=gelato.your-domain.com

# Backup retention (days)
BACKUP_RETENTION_DAYS=14
```

Generate strong secrets:

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32)"
echo "JWT_SECRET=$(openssl rand -base64 32)"
```

## Step 3 — SSL certificates (optional but recommended)

For HTTPS with Let's Encrypt:

```bash
# Install certbot
apt-get install -y certbot

# Get certificate (stop nginx first if running)
certbot certonly --standalone -d gelato.your-domain.com

# Copy certs to nginx ssl directory
mkdir -p /opt/gelato-core/docker/nginx/ssl
cp /etc/letsencrypt/live/gelato.your-domain.com/fullchain.pem /opt/gelato-core/docker/nginx/ssl/
cp /etc/letsencrypt/live/gelato.your-domain.com/privkey.pem /opt/gelato-core/docker/nginx/ssl/
```

Then uncomment the HTTPS server block in `docker/nginx/sites/gelato.conf`.

## Step 4 — Deploy

```bash
cd /opt/gelato-core/docker/scripts
./deploy.sh deploy
```

This will:
1. Pull latest code from git
2. Tag current image as rollback
3. Build fresh API + BackOffice images
4. Start all services (postgres, api, backoffice, backup)
5. Wait for PostgreSQL + API health
6. Run Prisma migrations
7. Seed database (idempotent — safe to re-run)
8. Run E2E smoke tests (24 scenarios)
9. Set up daily backup cron (02:00)

## Step 5 — Verify

```bash
# Health check
curl http://localhost:4000/api/health

# Metrics
curl http://localhost:4000/api/metrics

# E2E tests
docker exec gelato-api sh -c \
  "cd /app/apps/api && ./node_modules/.bin/tsx test/e2e-stack.ts"
```

Access:
- **API**: `http://your-vps-ip:4000/api`
- **BackOffice**: `http://your-vps-ip:3000`
- **Default login**: `admin@demo.de` / `admin123` (tenant: `demo`)

## Step 6 — Change admin password

After first login, change the admin password via the BackOffice or API:

```bash
# Generate new password hash
docker exec gelato-api node -e "
  const bcrypt = require('bcrypt');
  const hash = bcrypt.hashSync('YOUR_NEW_PASSWORD', 12);
  console.log(hash);
"

# Update via psql
docker exec gelato-postgres psql -U gelato -d gelatocore -c \
  "UPDATE users SET password_hash = '<hash_from_above>' WHERE email = 'admin@demo.de';"
```

## Ongoing operations

### Update (redeploy)

```bash
cd /opt/gelato-core
git pull origin main
cd docker/scripts
./deploy.sh deploy
```

### Rollback

```bash
./deploy.sh rollback
```

### Manual backup

```bash
docker/scripts/backup.sh
```

### Restore from backup

```bash
docker/scripts/restore.sh docker/backups/gelatocore-20260626-120000.sql.gz
```

### View logs

```bash
# All services
docker compose -f docker/docker-compose.yml logs -f

# API only
docker logs -f gelato-api --tail 100

# PostgreSQL
docker logs -f gelato-postgres --tail 50
```

### Check disk space

```bash
df -h
du -sh docker/backups/
docker system df
```

### Clean old Docker images

```bash
docker image prune -a --filter "until=168h" --force
```

## Troubleshooting

### API won't start

```bash
docker logs gelato-api --tail 50
# Common issues:
# - DATABASE_URL wrong (check .env)
# - Prisma client not generated (run migrate deploy)
# - Port already in use
```

### Database connection failed

```bash
# Check postgres is healthy
docker exec gelato-postgres pg_isready -U gelato

# Check credentials
docker exec gelato-postgres psql -U gelato -d gelatocore -c "SELECT 1;"

# Check .env DATABASE_URL matches
grep DATABASE_URL docker/.env
```

### BackOffice blank page

```bash
# Check it's built
docker exec gelato-backoffice ls /usr/share/nginx/html/

# Check nginx config
docker exec gelato-backoffice cat /etc/nginx/conf.d/default.conf
```

### E2E tests fail

```bash
docker exec gelato-api sh -c "cd /app/apps/api && ./node_modules/.bin/tsx test/e2e-stack.ts"
# Common: seed not run, migrations pending, wrong tenantSlug
```

## Security checklist

- [ ] Change POSTGRES_PASSWORD
- [ ] Change JWT_SECRET
- [ ] Change admin password
- [ ] Enable UFW firewall
- [ ] Set up SSL/HTTPS
- [ ] Configure backup retention
- [ ] Disable SSH password auth (use keys)
- [ ] Review Docker port bindings (only expose needed ports)
- [ ] Set up monitoring alerts (Prometheus + Grafana or Uptime Robot)
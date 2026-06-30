# gelato-core Docker

## Local development (Docker Desktop / Windows ou Linux)

```bash
cd docker

# 1. Configure env
cp .env.example .env

# 2. Start the stack (postgres, api, backoffice, backup)
docker compose up -d --build

# 3. Run migrations and seed (creates demo tenant + admin user)
docker exec gelato-api sh -c "cd /app/apps/api && ./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/tsx prisma/seed.ts"

# 4. Verify
curl http://127.0.0.1:4000/api/health
curl -o /dev/null http://127.0.0.1:3000/   # BackOffice

# 5. Run E2E smoke tests
docker exec gelato-api sh -c "cd /app/apps/api && ./node_modules/.bin/tsx test/e2e-stack.ts"
```

Default credentials seeded: `admin@demo.de` / `admin123` (tenant `demo`).

After the stack is up:
- **API**: <http://127.0.0.1:4000/api>
- **BackOffice**: <http://127.0.0.1:3000>
- **PostgreSQL**: `127.0.0.1:5432` (`gelato` / `gelato_password` / `gelatocore`)

## Production-style with nginx reverse proxy

The `docker-compose.override.yml` adds nginx for Linux VPS / production-like usage.
On Docker Desktop (Windows/macOS), the bridge networking + bind-mount quirks can
cause nginx host-proxy responses to flicker between 502/503. On a Linux VPS this
works reliably.

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --build
```

For production, obtain certificates and mount them:

```bash
sudo certbot certonly --standalone -d gelato.example.com
sudo cp /etc/letsencrypt/live/gelato.example.com/fullchain.pem nginx/ssl/
sudo cp /etc/letsencrypt/live/gelato.example.com/privkey.pem nginx/ssl/
docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --build
```

## Files

- `docker/docker-compose.yml` — core stack: postgres, api, backoffice, backup
- `docker/docker-compose.override.yml` — adds nginx reverse proxy for production
- `docker/Dockerfile.api` — multi-stage build of the NestJS API
- `docker/Dockerfile.backoffice` — multi-stage build of the BackOffice (nginx)
- `docker/Dockerfile.pos` — multi-stage build of the POS Terminal (nginx)
- `docker/nginx/nginx.conf` — base nginx config
- `docker/nginx/sites/gelato.conf` — production site with HTTPS and rate limits
- `docker/nginx/backoffice.conf` — local development nginx config for BackOffice
- `docker/nginx/pos-terminal.conf` — POS Terminal standalone nginx config
- `docker/.env.example` — environment variables
- `docker/Makefile` — convenience targets (`make up`, `make migrate`, `make smoke`)
- `docker/scripts/backup.sh` — manual DB backup
- `docker/scripts/restore.sh` — restore from backup
- `docker/scripts/migrate.sh` — apply migrations in running container
- `docker/scripts/deploy.sh` — automated VPS deploy

## Make targets

```bash
make up           # docker compose up -d --build
make up-prod      # with nginx override
make down         # tear down
make logs         # tail logs
make migrate      # run prisma migrate deploy
make seed         # run seed script
make smoke        # curl health + backoffice
make health       # curl API health JSON
```

## Security notes

- The PostgreSQL port is only mapped to host on Docker Desktop override; on a
  production server, drop the override or remove the `postgres` ports block.
- The API exposes 4000 directly for local dev. For production, use the nginx
  override and remove the API host port mapping.
- TLS 1.2+ with modern ciphers on the production HTTPS server block.
- Rate limits: `/api/` 20 req/s burst 40; `/api/auth/` 5 req/min burst 10.
- Daily automated PostgreSQL backups at 02:00, retention configurable via
  `BACKUP_RETENTION_DAYS`.
- Rotate all default passwords and JWT_SECRET before any real deployment.

## Known local-dev quirks on Docker Desktop

- `nginx` host-proxy may show intermittent 502/503 responses when bind-mounted
  config and the bridge DNS are slow to converge. The API itself is reachable
  directly on `:4000`; for development you can skip nginx and use the base
  compose only.
- The first `docker compose up` after fresh clones needs `--build` because the
  API image embeds a generated Prisma client and the multi-stage Dockerfile
  runs `pnpm --filter api db:generate`.
.PHONY: up down logs migrate seed smoke health up-prod

up:
	docker compose up -d --build

up-prod:
	docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --build

down:
	docker compose -f docker-compose.yml -f docker-compose.override.yml down

logs:
	docker compose -f docker-compose.yml -f docker-compose.override.yml logs -f

migrate:
	docker exec gelato-api sh -c "cd /app/apps/api && ./node_modules/.bin/prisma migrate deploy"

seed:
	docker exec gelato-api sh -c "cd /app/apps/api && ./node_modules/.bin/tsx prisma/seed.ts"

smoke:
	@curl -fsS http://127.0.0.1:4000/api/health
	@curl -fsS -o /dev/null http://127.0.0.1:3000/
	@echo "Smoke tests passed"

health:
	@curl -fsS http://127.0.0.1:4000/api/health

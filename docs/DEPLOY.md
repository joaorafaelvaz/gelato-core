# Deploy — gelato.linkwise.digital

Stack de **demo/staging** num VPS único: Postgres (interno) + API NestJS + Caddy
(TLS automático via Let's Encrypt, serve o backoffice e faz proxy de `/api/*`).

> ⚠️ **Não é deploy fiscal de produção.** Sem credenciais fiskaly no `.env.prod`, a
> assinatura TSE usa o `FakeTseProvider` (recibos NÃO têm valor fiscal). O adapter
> fiskaly real segue NÃO VERIFICADO (sandbox + doc viva + certificação BSI pendentes),
> e as validações do Steuerberater (MwSt, DSFinV-K, QR DFKA) continuam em aberto.
> O seed demo cria `admin@demo.test`/`admin123` — não use em produção real.

## Arquitetura

```
Internet ──443──> Caddy ──/api/*──> api:3000 (NestJS, role gelato_app)
                    │                  │
                    └── /srv (dist do backoffice, Vite, VITE_API_URL=/api)
                                       └────> db:5432 (Postgres 16, interno)
```

- Uma origem só (`https://gelato.linkwise.digital`): sem CORS; o backoffice chama `/api`.
- Migrações rodam como `gelato_owner`; a API roda como `gelato_app` (imutabilidade
  fiscal do banco vale igual em produção — migração `fix_schema_usage_grant` cobre resets).
- Arquivos: `docker/deploy/` (compose, Dockerfiles, Caddyfile, deploy.sh, db-init).

## Passo a passo

1. **DNS:** crie o registro A `gelato.linkwise.digital → IP do VPS` (antes do deploy;
   o Let's Encrypt valida por HTTP).
2. **No VPS** (Ubuntu/Debian, root):
   ```bash
   git clone https://github.com/joaorafaelvaz/gelato-core.git /opt/gelato-core
   cd /opt/gelato-core/docker/deploy
   ./deploy.sh setup      # Docker + ufw(22/80/443) + gera .env.prod com senhas fortes
   nano .env.prod         # confira DOMAIN e ACME_EMAIL
   ./deploy.sh deploy     # build + migrate + up + health check
   ./deploy.sh seed       # opcional: dados demo
   ```
3. Abra `https://gelato.linkwise.digital` → login `admin@demo.test` / `admin123`.

## Operação

| Comando | Faz |
|---|---|
| `./deploy.sh deploy` | atualiza (git pull), rebuilda, migra e sobe; cria tag `deploy-<ts>` |
| `./deploy.sh rollback` | volta o código à tag de deploy anterior e rebuilda (**banco não volta** — migrações são forward-only) |
| `./deploy.sh status` | `compose ps` + health (`/api/products` → 401 = ok) |
| `./deploy.sh logs [svc]` | logs (api, caddy, db) |

Backup do banco (recomendado antes de deploys):
```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec db \
  pg_dump -U gelato_owner -d gelato | gzip > /opt/backups/gelato-$(date +%F).sql.gz
```

## Fora deste deploy

pos-web/terminal (são apps de Kasse, não fazem sentido públicos), monitoramento,
backups automáticos agendados, submissão ELSTER. A branch `alt-implementation` tem um
script de referência com nginx/backup-cron caso se queira evoluir isso depois.

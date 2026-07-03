#!/usr/bin/env bash
# ============================================================
# gelato-core — deploy num VPS (gelato.linkwise.digital)
#
#   ./deploy.sh setup     provisionamento inicial (Docker, ufw, .env.prod)
#   ./deploy.sh deploy    git pull + build + migrate + up (default)
#   ./deploy.sh seed      seed demo (admin@demo.test/admin123) — opcional
#   ./deploy.sh rollback  volta ao deploy anterior (tag git) + rebuild
#   ./deploy.sh status    estado dos containers + health
#   ./deploy.sh logs [svc] logs (default: api)
#
# Pré-requisitos: VPS Ubuntu/Debian com root; DNS A de $DOMAIN apontando
# para o IP do VPS ANTES do primeiro deploy (Let's Encrypt valida por HTTP).
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.prod"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$SCRIPT_DIR/docker-compose.prod.yml")
STAGE="${1:-deploy}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
err()  { echo -e "${RED}[erro]${NC} $*" >&2; }

require_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    err "faltando $ENV_FILE — rode './deploy.sh setup' primeiro"
    exit 1
  fi
}

# ------------------------------------------------------------
setup() {
  log "SETUP — provisionando o VPS"
  if [[ $EUID -ne 0 ]]; then err "setup precisa de root"; exit 1; fi

  # tolera repositórios de TERCEIROS quebrados no VPS (ex. PPA sem release);
  # os pacotes abaixo vêm dos repos principais
  apt-get update -qq || warn "apt update falhou parcialmente (repo de terceiros quebrado?) — seguindo"
  apt-get install -y -qq curl git ufw ca-certificates openssl

  if ! command -v docker >/dev/null 2>&1; then
    log "instalando Docker…"
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
  else
    log "Docker já presente: $(docker --version)"
  fi
  docker compose version >/dev/null 2>&1 || apt-get install -y -qq docker-compose-plugin

  log "firewall (ufw): liberando 22/80/443 (não-fatal)"
  if command -v ufw >/dev/null 2>&1 && ufw allow 22/tcp >/dev/null 2>&1; then
    ufw allow 80/tcp >/dev/null 2>&1 || true
    ufw allow 443/tcp >/dev/null 2>&1 || true
    if ufw status 2>/dev/null | grep -q "Status: active"; then
      log "ufw ativo — regras adicionadas"
    else
      warn "ufw INATIVO — não habilitei automaticamente (pode haver outros serviços"
      warn "neste host). Revise e rode 'ufw enable' você mesmo."
    fi
  else
    warn "ufw indisponível/quebrado neste host — firewall PULADO."
    warn "Configure manualmente depois (só 22/80/443 precisam estar abertas)."
  fi

  if [[ ! -f "$ENV_FILE" ]]; then
    log "gerando $ENV_FILE com senhas fortes…"
    cat > "$ENV_FILE" <<EOF
DOMAIN=gelato.linkwise.digital
ACME_EMAIL=vaz.rafael@gmail.com
POSTGRES_OWNER_PASSWORD=$(openssl rand -hex 24)
POSTGRES_APP_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
FISKALY_API_KEY=
FISKALY_API_SECRET=
FISKALY_TSS_ID=
EOF
    chmod 600 "$ENV_FILE"
    log "revise o $ENV_FILE (DOMAIN/ACME_EMAIL) antes do deploy"
  else
    warn "$ENV_FILE já existe — mantido"
  fi

  log "SETUP ok. Confirme o DNS A de \$DOMAIN → IP deste VPS e rode './deploy.sh deploy'."
}

# ------------------------------------------------------------
deploy() {
  require_env
  log "DEPLOY — $(date -u +%FT%TZ)"

  # modo atrás-de-proxy (nginx do host termina o TLS): CADDY_HTTP_BIND=127.0.0.1:8080
  local http_bind behind_proxy=""
  http_bind=$(grep -E '^CADDY_HTTP_BIND=' "$ENV_FILE" | cut -d= -f2- || true)
  [[ "$http_bind" == 127.0.0.1:* ]] && behind_proxy=1

  if [[ -z "$behind_proxy" ]]; then
    # modo edge: o Caddy precisa de 80 (ACME) e 443 livres
    local busy
    busy=$(ss -ltnp 2>/dev/null | awk '$4 ~ /:(80|443)$/ {print $4, $6}' | grep -v docker || true)
    if [[ -n "$busy" ]]; then
      err "portas 80/443 já ocupadas por outro processo neste VPS:"
      echo "$busy" >&2
      err "libere as portas OU use o modo atrás-de-proxy (ver docs/DEPLOY.md,"
      err "seção 'Atrás de um nginx existente')."
      exit 1
    fi
  else
    log "modo atrás-de-proxy: Caddy interno em ${http_bind} (TLS fica com o nginx do host)"
  fi

  if [[ -d "$REPO_DIR/.git" ]]; then
    log "atualizando o repositório (git pull --ff-only)…"
    git -C "$REPO_DIR" pull --ff-only
  fi

  log "build das imagens (api + web/caddy)…"
  "${COMPOSE[@]}" build --pull

  log "subindo o banco…"
  "${COMPOSE[@]}" up -d db
  "${COMPOSE[@]}" wait db 2>/dev/null || sleep 5

  log "migrações (prisma migrate deploy, como gelato_owner)…"
  "${COMPOSE[@]}" run --rm --no-deps --entrypoint "" api \
    sh -c "cd apps/api && ./node_modules/.bin/prisma migrate deploy"

  log "subindo api + caddy…"
  "${COMPOSE[@]}" up -d

  log "health check…"
  sleep 5
  local health_host="127.0.0.1" code
  [[ -n "$behind_proxy" ]] && health_host="$http_bind"
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://${health_host}/api/products" || true)
  if [[ "$code" == "401" ]]; then
    log "API respondendo atrás do Caddy (401 sem token = ok)"
  else
    warn "health inesperado: HTTP $code — veja './deploy.sh logs' e './deploy.sh logs caddy'"
  fi

  local tag="deploy-$(date -u +%Y%m%d-%H%M%S)"
  git -C "$REPO_DIR" tag "$tag" >/dev/null 2>&1 && log "tag de deploy: $tag" || true

  log "DEPLOY ok → https://$(grep '^DOMAIN=' "$ENV_FILE" | cut -d= -f2)"
}

# ------------------------------------------------------------
seed() {
  require_env
  log "SEED demo (admin@demo.test / admin123 — só para demo!)…"
  "${COMPOSE[@]}" run --rm --no-deps --entrypoint "" api \
    sh -c "cd apps/api && ./node_modules/.bin/tsx prisma/seed-run.ts"
  log "seed ok"
}

# ------------------------------------------------------------
rollback() {
  require_env
  local prev
  prev=$(git -C "$REPO_DIR" tag -l 'deploy-*' --sort=-creatordate | sed -n '2p')
  if [[ -z "$prev" ]]; then err "não há deploy anterior para voltar"; exit 1; fi
  warn "ROLLBACK para $prev (o banco NÃO é revertido — migrações são forward-only)"
  git -C "$REPO_DIR" checkout "$prev"
  "${COMPOSE[@]}" build
  "${COMPOSE[@]}" up -d
  log "rollback ok — o repositório está em detached HEAD ($prev); 'git checkout main' para voltar"
}

# ------------------------------------------------------------
status() {
  require_env
  "${COMPOSE[@]}" ps
  curl -s -o /dev/null -w "health /api/products: HTTP %{http_code} (401 = ok)\n" http://127.0.0.1/api/products || true
}

logs() {
  require_env
  "${COMPOSE[@]}" logs -f --tail 200 "${2:-api}"
}

case "$STAGE" in
  setup)    setup ;;
  deploy)   deploy ;;
  seed)     seed ;;
  rollback) rollback ;;
  status)   status ;;
  logs)     logs "$@" ;;
  *) err "stage desconhecido: $STAGE (setup|deploy|seed|rollback|status|logs)"; exit 1 ;;
esac

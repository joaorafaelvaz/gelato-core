# gelato-core

German-fiscal-compliant POS system for gelaterias. Multi-tenant, offline-first, TSE-ready.

## Stack

- **Monorepo**: pnpm + Turborepo
- **API**: NestJS + Prisma + PostgreSQL (20+ modules)
- **BackOffice**: React + Vite + TailwindCSS + React Query (15+ pages)
- **POS Terminal**: React + Vite + TailwindCSS + Tauri 2 (offline-first)
- **TSE**: fiskaly (cloud, real HTTP API) + Swissbit (local, skeleton)
- **Deploy**: Docker Compose + nginx + automated backups
- **CI**: GitHub Actions (unit, E2E, Docker build)
- **Monitoring**: Prometheus metrics + health checks

## Quick start

```bash
pnpm install
cd docker
cp .env.example .env
docker compose up -d --build
docker exec gelato-api sh -c \
  "cd /app/apps/api && ./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/tsx prisma/seed.ts"
curl http://127.0.0.1:4000/api/health
```

Default: `admin@demo.de` / `admin123` (tenant `demo`).

## Features (16 phases)

### Phase 0-1: Foundation + Fiscal Core
- Multi-tenant auth (JWT + RBAC: admin, operator, lagerist)
- Tenant → Betriebsstätte → Kasse hierarchy
- Append-only PostgreSQL triggers on fiscal tables
- Cloud TSE via fiskaly (OAuth2 + real signing API)
- TSE-Ausfall mode with automatic retry (cron every 2 min)
- Receipts with QR code payload

### Phase 2: Stock & Recipes
- Products with variants and modifiers
- Ingredients with base units
- Stock items per branch, movements (RECEIVING, WASTE, COUNT, etc.)
- Recipes (BOM) with automatic consumption on sale
- Stock availability calculation + low-stock alerts

### Phase 3: Reports
- X-Report (live snapshot, MwSt breakdown by rate)
- Z-Report (persisted, sequential, closes shift)
- DSFinV-K CSV export
- Kassenabschluss JSON export

### Phase 4-5: Deploy + CI/CD
- Docker Compose (postgres, api, backoffice, backup)
- nginx reverse proxy with rate limiting + TLS
- GitHub Actions CI (typecheck, unit, E2E, Docker build)
- Helmet security headers, CORS, audit IP interceptor
- Prometheus metrics at `/api/metrics`

### Phase 6-7: POS Flow
- Shift management (open/close with float)
- Order creation with MwSt calculation (IM_HAUS / AUSSER_HAUS)
- Order finalization with TSE signing + receipt
- Storno (void) with TSE `Storno` process type
- Append-only trigger refined (status-only UPDATE on orders)

### Phase 8-9: POS Terminal
- Product catalog with search + grid
- Product modal (variants + modifiers selection)
- Cart with qty, MwSt totals, payment method
- Checkout: createOrder → finalizeOrder → receipt screen
- Offline-first: localStorage queue + auto-sync when online
- Online/offline indicator with pending count

### Phase 10: BackOffice + Tauri
- Products CRUD form with MwSt configuration
- Ingredients CRUD form
- Fiscal Dashboard (X/Z reports, Kassenabschluss export)
- Tauri 2 desktop scaffolding (src-tauri/ with Cargo.toml)

### Phase 11: TSE Integration
- Real fiskaly adapter (OAuth2, token caching, PUT /tx)
- Swissbit skeleton (mock signatures, SDK-ready)
- Admin TSE endpoints (register/deregister/list)
- BackOffice TSE Management page
- Comprehensive TSE documentation

### Phase 12: Analytics + Customers + Audit
- Sales Dashboard (salesByDay, topProducts, paymentBreakdown)
- Customer CRUD with loyalty accounts
- Audit Log viewer with filters + pagination

### Phase 13: Loyalty + Discounts
- Loyalty points (award/redeem, auto-award on sale)
- Loyalty stamps
- Order discounts (PERCENTAGE / FIXED)
- BackOffice Loyalty page

### Phase 14: Vouchers + Promotions
- Voucher CRUD (FIXED_AMOUNT, PERCENTAGE, PRODUCT)
- Voucher validation + redemption in order flow
- Promotion CRUD (JSON rules, activate/deactivate)
- BackOffice Vouchers + Promotions pages

### Phase 15: Campaigns + i18n
- Campaign CRUD (EMAIL/WHATSAPP/SMS, scheduling, status flow)
- Customer segmentation (minPoints, hasEmail, city)
- Segment preview (count + sample)
- Full i18n BackOffice (DE/EN/PT for all navigation + common labels)

### Phase 16: Advanced Analytics + Settings
- Sales by hour (bar chart heatmap)
- Sales by branch (revenue + order count)
- Tenant settings (default MwSt, currency, language, loyalty config)
- Settings page in BackOffice

## API endpoints (30+)

| Area | Method | Path | Permission |
|------|--------|------|------------|
| Auth | POST | `/api/auth/login` | public |
| Health | GET | `/api/health` | public |
| Metrics | GET | `/api/metrics` | public |
| Analytics | GET | `/api/analytics/dashboard` | auth |
| Tenants | GET/POST | `/api/tenants` | admin |
| Branches | GET/POST | `/api/branches` | admin.settings |
| Kassen | GET/POST | `/api/kassen` | admin.settings |
| Users | GET/POST | `/api/users` | admin.users |
| Products | GET/POST | `/api/products` | product.view/manage |
| Stock | GET/POST | `/api/stock/*` | stock.view/manage/adjust |
| Shifts | POST | `/api/pos/shifts` | pos.shift.open/close |
| Orders | POST | `/api/pos/orders` | pos.sale.create |
| Finalize | POST | `/api/pos/orders/:id/finalize` | pos.sale.create |
| Void | POST | `/api/pos/orders/:id/void` | pos.sale.void |
| X-Report | GET | `/api/reports/x/:kasseId` | pos.report.x |
| Z-Report | POST | `/api/reports/z/:kasseId` | pos.report.z |
| DSFinV-K | GET | `/api/exports/dsfinvk/:tenantId` | admin.export.dsfinvk |
| TSE | POST | `/api/admin/tse/register` | admin.tse |
| Settings | GET/POST | `/api/admin/settings` | admin.settings |
| Customers | GET/POST | `/api/customers` | customer.manage |
| Loyalty | GET/POST | `/api/loyalty/*` | customer.manage |
| Vouchers | GET/POST | `/api/vouchers` | marketing.view/manage |
| Promotions | GET/POST | `/api/promotions` | marketing.view/manage |
| Campaigns | GET/POST | `/api/campaigns` | marketing.view/manage |
| Audit | GET | `/api/audit` | admin.users |

## E2E tests (24 scenarios)

```bash
node apps/api/test/e2e-stack.ts
```

## Documentation

- [TSE Integration](docs/TSE_INTEGRATION.md)
- [Docker Deploy](docker/README.md)

## License

UNLICENSED — private project.
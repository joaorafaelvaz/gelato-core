# TSE Integration Guide

## Overview

gelato-core supports German fiscal TSE (Technische Sicherheitseinrichtung) through an adapter pattern. Two providers are supported:

- **fiskaly** (cloud TSE) — fully implemented with real HTTP API calls
- **Swissbit** (local USB/SD card TSE) — skeleton implementation (mock signatures)

## Architecture

```
PosService.finalizeOrder()
  → TseFactory.create(config)
    → FiskalyTseAdapter | SwissbitTseAdapter
      → ITseProvider.sign(req)
        → TseSignResult { signatureValue, signatureCounter, isAusfall, ... }
  → FiscalService.signOrder()
    → TseTransaction record persisted
  → Receipt created with QR payload
```

## Providers

### fiskaly (cloud)

- **Adapter**: `apps/api/src/compliance/tse/fiskaly-tse.adapter.ts`
- **Authentication**: OAuth2 via `POST /auth` with `api_key` + `api_secret`
- **Signing**: `PUT /tss/{tssId}/tx/{txNumber}` with Bearer token
- **Token caching**: Access token cached with expiry, auto-refreshed
- **Mock mode**: When no `apiKey`/`apiSecret` provided, returns mock signatures
- **Ausfall mode**: When cloud is unreachable, returns `isAusfall: true` with documented error

### Swissbit (local USB/SD)

- **Adapter**: `apps/api/src/compliance/tse/swissbit-tse.adapter.ts`
- **Status**: Skeleton — returns mock signatures. In production, this must:
  1. Use the Swissbit SDK (C library via FFI/N-API) to communicate with the USB/SD device
  2. Call `StartTransaction` / `FinishTransaction` with process type and payload
  3. Read the ECDSA signature, counter, and log time from the device
  4. Store the transaction log on the device's storage

## TSE-Ausfall handling

1. The adapter returns `success: true, isAusfall: true` when the TSE is unreachable.
2. `FiscalService` stores the transaction with `isAusfall = true`.
3. `PosService.finalizeOrder()` issues the receipt with `qrPayload = 'TSE-AUSFALL'`.
4. `TseRetryService` runs every 2 minutes to re-sign pending Ausfall transactions.

## Admin endpoints

Register and manage TSE clients via the admin API:

```
POST   /api/admin/tse/register         — Register a new TSE client
GET    /api/admin/tse                   — List all active TSE clients
GET    /api/admin/tse/kasse/:kasseId    — Get active TSE client for a kasse
POST   /api/admin/tse/:id/deregister    — Deregister a TSE client
```

### Register a fiskaly TSE client

```bash
curl -X POST http://localhost:4000/api/admin/tse/register \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "kasseId": "<kasse-uuid>",
    "provider": "fiskaly",
    "serialNumber": "FISKALY-SERIAL",
    "apiUrl": "https://kassensichv.fiskaly.com/api/v0",
    "apiKey": "your-api-key",
    "apiSecret": "your-api-secret",
    "tssId": "your-tss-id"
  }'
```

### Register a Swissbit TSE client

```bash
curl -X POST http://localhost:4000/api/admin/tse/register \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "kasseId": "<kasse-uuid>",
    "provider": "swissbit",
    "serialNumber": "SWISSBIT-SERIAL"
  }'
```

## BackOffice UI

Navigate to **TSE Management** (`/tse`) in the BackOffice to:
- Register new TSE clients (fiskaly or Swissbit)
- View registered TSE clients with provider, serial, kasse, status
- Deregister TSE clients

## Configuration via .env

TSE credentials are stored in the `tse_clients` table (encrypted credentials JSON). The API reads them at runtime when creating the TSE provider. Never commit real credentials to the repository.

## Important

- Validate all MwSt rates and DSFinV-K exports with your **Steuerberater / tax advisor** before production.
- Real fiskaly integration requires a contract with fiskaly, API credentials, and a registered TSS.
- Swissbit integration requires the vendor SDK and a physical Swissbit TSE device.
- Never commit real TSE credentials; use environment variables or a secret manager.
- The `TseRetryService` cron job automatically re-signs Ausfall transactions every 2 minutes.
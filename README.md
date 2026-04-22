# OrthoNu Intelligent Backend

Node.js + TypeScript + PostgreSQL backend powering the OrthoNu Clinical Intelligence Platform's Dentira Care integration.

## What This Does

Three-phase workflow (see sequence diagram in `context/Dentira Care - OrthoNu API Specs.pdf`):

1. **OrthoNu → Dentira Care**: CDT code triggers `createTemplatePrescription` — patient receives email with QR code to order products.
2. **Dentira Care → OrthoNu**: Patient orders via QR; Dentira POSTs an order webhook to `/webhooks/dentira/orders`.
3. **OrthoNu → Dentira Care**: OrthoNu acknowledges order, calculates tax, updates status through SHIPPED → DELIVERED.

The Chrome overlay authenticates against this backend (JWT), looks up CDT protocols, and triggers prescriptions.

---

## Local Setup

### Prerequisites

- Node.js 20 LTS
- pnpm (`npm i -g pnpm`)
- PostgreSQL 15 (running locally or DO managed)

### 1. Clone and install

```bash
cd Orthonu-intelligent
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — minimum required:
# DATABASE_URL=postgresql://user:pass@localhost:5432/orthonu
# DENTIRA_CLIENT_SECRET=teez5cah5aeRoocup5iet5dip4uuChohTeeraivuji0mei0yahmeiQu1tuawaiph
# JWT_SECRET=<at-least-32-random-chars>
```

### 3. Create the database

```bash
psql -U postgres -c "CREATE DATABASE orthonu;"
```

### 4. Run migrations

```bash
pnpm migrate
```

This applies all `migrations/*.sql` files in order, tracked in the `_migrations` table.

### 5. Seed products + protocols

```bash
pnpm seed
```

Reads `OrthoNu_Clinical_Protocol_Master_Chart.xlsx` from the `context/` folder.
Falls back to the POC's `cdt-mapping-schema.json` if the xlsx is unavailable.
Seeds 7 products and up to 80 protocol rows. Idempotent — safe to re-run.

**Important:** After Deepankar confirms real Dentira variantIds for each OrthoNu product, update `dentira_variant_map` rows:

```sql
UPDATE dentira_variant_map
SET dentira_variant_id = 'V-REAL-ID-HERE'
WHERE orthonu_product_id = (SELECT id FROM orthonu_products WHERE sku = 'SKU-ON-1001');
```

### 6. Start the server

```bash
# Development (hot reload)
pnpm dev

# Production
pnpm build && pnpm start
```

Server starts on `PORT` (default `3001`).

### 7. Run unit tests

```bash
pnpm test
```

### 8. Run sandbox integration test (requires internet)

```bash
pnpm test:sandbox
```

Hits the real Dentira sandbox, fetches a token, creates a test prescription with placeholder variantId `V20010`.

---

## Project Structure

```
src/
  config/        — Zod-validated env config
  db/            — pg pool, migrations runner
  auth/          — JWT issue/verify for Chrome overlay
  dentira/       — Token manager, GraphQL client, prescription service,
                   webhook handler, order processor, types
  protocols/     — CDT lookup service
  api/
    routes/      — Express route handlers (auth, protocols, prescriptions, webhooks, health)
    middleware/  — JWT auth guard, error handler
  jobs/          — pg-boss worker registration
  lib/           — logger (pino), error types
migrations/      — Numbered SQL files
scripts/
  seed-protocols.ts       — Reads xlsx, seeds DB
  test-dentira-sandbox.ts — Integration test vs real sandbox
```

---

## API Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | DB + token health check |
| POST | `/api/auth/login` | None | Issue JWT for Chrome overlay |
| GET | `/api/protocols/:cdtCode` | JWT | Lookup protocol by CDT code |
| GET | `/api/protocols` | JWT | List all 80 protocols |
| POST | `/api/prescriptions` | JWT | Create Dentira prescription |
| GET | `/api/prescriptions/:id` | JWT | Get prescription + order status |
| POST | `/webhooks/dentira/orders` | Signature | Receive order from Dentira Care |

See `curl-examples.md` for full request/response examples.

---

## Demo Login

For the POC/pilot, use:
- `clinicId`: any string (e.g. `"clinic-001"`)
- `apiKey`: `orthonu-demo-key-2026`

The `apiKey` is hardcoded in `src/api/routes/auth.ts` for the demo. Replace with a real clinic credential lookup before production.

---

## Environment Variables

| Variable | Default | Required |
|----------|---------|----------|
| `NODE_ENV` | `development` | No |
| `PORT` | `3001` | No |
| `DATABASE_URL` | — | **Yes** |
| `DENTIRA_BASE_URL` | `https://vendor-caresbx.dentira.com` | No |
| `DENTIRA_CLIENT_ID` | `ortho_nu` | No |
| `DENTIRA_CLIENT_SECRET` | — | **Yes** |
| `DENTIRA_WEBHOOK_SECRET` | — | No (pending Dentira) |
| `JWT_SECRET` | — | **Yes** (≥32 chars) |
| `LOG_LEVEL` | `info` | No |
| `DEMO_MODE` | `false` | No |

`DEMO_MODE=true` simulates SHIPPED (30s) and DELIVERED (60s) status updates automatically after an order arrives — for DSO Connect demo only.

---

## Production Deployment (DigitalOcean Droplet)

```bash
# Build
pnpm build

# PM2
pm2 start dist/server.js --name orthonu-backend

# Caddy / nginx: reverse-proxy port 3001, SSL via Let's Encrypt
# Webhook endpoint must be publicly reachable over HTTPS:
# https://your-domain.com/webhooks/dentira/orders
```

---

## Out of Scope (April 30 POC)

- Dentira Procurement integration (URL redirect only — no backend code)
- Inventory tracking
- Email sending (Dentira Care handles it)
- Stripe / payments
- Admin UI

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

---

## Epic CDS Hooks Integration

### Overview

OrthoNu exposes a CDS Hooks 1.0–compliant service that integrates with Epic EHR. When a clinician views a patient chart (`patient-view`) or selects a dental procedure order (`order-select`), Epic calls the OrthoNu endpoint, which returns CDS Cards recommending supportive oral care products. When the clinician accepts a card, Epic posts feedback and OrthoNu asynchronously writes a progress note (`DocumentReference`) back to the patient's chart.

### Architecture Flow

```
Epic EHR
  │
  │  POST /cds-services/{serviceId}   Bearer JWT (RS384)
  ▼
OrthoNu CDS Service
  ├── JWT validate  (Epic's JWKS → createRemoteJWKSet)
  ├── Decision Engine
  │     Step 1: CDT code match (order-select) or ICD-10 encounterDx (patient-view)
  │     Step 2: ICD-10 symptom confirmation in problems list
  │     → NoMatch  → { cards: [] }
  │     → Passive  → CORE.CDS.PASSIVE card
  │     → Match    → Scenario card(s) with suggestions + SMART link
  ├── Suppression check  (complication / infection / pain / lesion)
  └── Response  { cards: [...] }
          │
          │  POST /cds-services/{serviceId}/feedback   Bearer JWT
          ▼
     Feedback Handler
          │
          │  pg-boss job: epic-documentreference-write
          ▼
     Write-back Worker
          │  POST {fhirServer}/api/FHIR/R4/DocumentReference
          ▼
     Epic FHIR API  (DocumentReference.Create, LOINC 11506-3)
```

### Local Setup — Epic Delta

**1. Generate RSA keypair (RS384)**

```bash
mkdir -p keys
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out keys/sandbox-private.pem
openssl rsa -pubout -in keys/sandbox-private.pem -out keys/sandbox-public.pem
```

**2. Add Epic env vars to `.env`**

```env
EPIC_ENV=sandbox
EPIC_CLIENT_ID_SANDBOX=53f42d61-92ee-4db7-8698-5a27c3db8d4f
EPIC_CLIENT_ID_PRODUCTION=6c2d33c7-024c-43b5-97ff-33568bd0931f
EPIC_FHIR_BASE_URL=https://vendorservices.epic.com/interconnect-amcurprd-oauth
EPIC_JWKS_URL=https://fhir.epic.com/.well-known/jwks          # from Epic docs
EPIC_EXPECTED_ISS=https://fhir.epic.com/interconnect-fhir-oauth  # from Epic docs
EPIC_PRIVATE_KEY_PATH=./keys/sandbox-private.pem
EPIC_PUBLIC_KEY_PATH=./keys/sandbox-public.pem
EPIC_KEY_ID=orthonu-sandbox-2026-04
EPIC_CDS_BASE_URL=https://cds.orthonu.com
```

**3. Install new dependency**

```bash
pnpm install   # picks up express-rate-limit from package.json
```

**4. Run migrations**

```bash
pnpm migrate   # adds migrations 009–013 (5 new Epic tables)
```

**5. Seed SmartPhrases**

```bash
pnpm epic:seed
```

Reads `context/epic cds/OrthoNu_SmartPhrase_Build_Package_SSD.xlsx` and populates `epic_smartphrases` (42 phrases). Idempotent — safe to re-run.

### Where to Point Epic's Endpoint URI

On the Epic App Orchard portal, set:
- **Endpoint URI**: `https://cds.orthonu.com/cds-services`
- **JWK Set URL (Non-Production)**: `https://cds-sandbox.orthonu.com/.well-known/jwks.json`
- **JWK Set URL (Production)**: `https://cds.orthonu.com/.well-known/jwks.json`

Epic will then call:
- `GET https://cds.orthonu.com/cds-services` (discovery)
- `POST https://cds.orthonu.com/cds-services/orthonu-oral-intelligence`
- `POST https://cds.orthonu.com/cds-services/orthonu-protocol-engine`
- `POST https://cds.orthonu.com/cds-services/orthonu-{id}/feedback`

### Running the Sandbox Integration Test

```bash
pnpm epic:test-sandbox
```

Runs 6 assertions end-to-end against `localhost:3001`:
1. Discovery returns 2 services with correct IDs
2. JWKS endpoint returns RS384 key with kid
3. Constructs a synthetic D4341 hook request with K05.30 problem
4. Asserts a SCENARIO.PERIO.CHILLIN or passive card is returned
5. POSTs feedback with `outcome=accepted`
6. Polls `epic_documentreference_writes` for status=succeeded|failed (30s timeout)

### Troubleshooting

| Symptom | Check |
|---------|-------|
| `JWT validation failed — reason: ERR_JWKS_NO_MATCHING_KEY` | Verify `EPIC_JWKS_URL` points to Epic's live JWKS endpoint. Check `EPIC_KEY_ID` matches the `kid` in your key file. |
| `JWT validation failed — reason: ERR_JWT_CLAIM_VALIDATION_FAILED` | Check `EPIC_EXPECTED_ISS` matches Epic's `iss` claim exactly. Check `EPIC_CDS_BASE_URL` matches the registered endpoint URI. |
| `Epic config invalid: EPIC_CLIENT_ID_SANDBOX is required` | Set `EPIC_CLIENT_ID_SANDBOX` in `.env` and restart. |
| `FHIR 401 after token refresh` | Check `EPIC_PRIVATE_KEY_PATH` is readable; check `EPIC_CLIENT_ID_SANDBOX` matches portal. Check system clock drift (< 5s tolerance on Epic JWT validation). |
| SmartPhrase seed: `0 phrases inserted` | Check xlsx file exists at `context/epic cds/OrthoNu_SmartPhrase_Build_Package_SSD.xlsx`. |
| Write-back worker `failed` status | Epic FHIR credentials may not be configured. Check `epic_access_tokens` table. |

### TODOs (Phase 2)

<!-- TODO(epic-phase-2): Replace keyword-based suppression with ICD-10 range matching -->
<!-- TODO(epic-phase-2): Add CDT Product Matrix (210 rows) table for richer passive CDS -->
<!-- TODO(epic-phase-2): SMART on FHIR app registration (separate Epic process) -->
<!-- TODO(epic-phase-2): Toolbox/Showroom designation (requires BAA) -->
<!-- TODO(epic-phase-2): Add "already-declined in same encounter" suppression DB check -->

---

## Out of Scope (April 30 POC)

- Dentira Procurement integration (URL redirect only — no backend code)
- Inventory tracking
- Email sending (Dentira Care handles it)
- Stripe / payments
- Admin UI

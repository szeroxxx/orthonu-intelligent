# OrthoNu Backend — cURL Examples

Replace `http://localhost:3001` with your production URL.
Replace `<JWT>` with the token returned from `/api/auth/login`.

---

## Health Check

```bash
curl http://localhost:3001/health
```

**Response:**
```json
{
  "status": "ok",
  "dentiraTokenValid": true,
  "dbConnected": true,
  "timestamp": "2026-04-22T00:00:00.000Z"
}
```

---

## Auth — Get JWT for Chrome Overlay

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"clinicId": "clinic-pds-001", "apiKey": "orthonu-demo-key-2026"}'
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "expiresIn": "8h"
}
```

---

## Protocols — Lookup by CDT Code

```bash
curl http://localhost:3001/api/protocols/D8030 \
  -H "Authorization: Bearer <JWT>"
```

**Response:**
```json
{
  "cdtCode": "D8030",
  "protocols": [
    {
      "id": 1,
      "cdt_code": "D8030",
      "diagnosis": "Comprehensive orthodontic treatment of the adolescent dentition",
      "specialty": "Orthodontics",
      "icd10_code": "K07.6",
      "confidence_pct": 94,
      "trigger_condition": "Apply at initial braces placement",
      "application_notes": "Provide for home care",
      "follow_up_protocol": "Check-in at 2 weeks",
      "product": {
        "id": 1,
        "name": "Braces Starter Collection",
        "sku": "SKU-ON-1001",
        "msrp_cents": 18999,
        "dso_price_cents": 11000,
        "dissolvable": false,
        "category": "Orthodontics",
        "description": "Complete starter kit for braces patients"
      },
      "dentira_variant_id": null
    }
  ]
}
```

---

## Protocols — List All (80 rows)

```bash
curl http://localhost:3001/api/protocols \
  -H "Authorization: Bearer <JWT>"
```

---

## Prescriptions — Create

```bash
curl -X POST http://localhost:3001/api/prescriptions \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "cdtCode": "D8030",
    "patient": {
      "name": "Sarah Chen",
      "email": "sarah.chen@example.com"
    },
    "notes": "Braces start — comfort protocol",
    "doctorId": "DR-SMITH-001"
  }'
```

**Response (201):**
```json
{
  "prescriptionId": "abc-def-123",
  "prescriptionCode": "RX-2026-001",
  "qrImageUrl": "https://cdn.dentira.smaitic.dev/qr/abc-def-123.png",
  "pdfFileUrl": "https://cdn.dentira.smaitic.dev/pdf/abc-def-123.pdf"
}
```

> **Note:** Returns 422 if no Dentira variantId is mapped yet for this CDT code's products.
> Contact Deepankar to get real variantIds and update `dentira_variant_map`.

---

## Prescriptions — Get Status

```bash
# By internal ID or Dentira prescription ID
curl http://localhost:3001/api/prescriptions/abc-def-123 \
  -H "Authorization: Bearer <JWT>"
```

**Response:**
```json
{
  "id": 1,
  "dentira_prescription_id": "abc-def-123",
  "patient_email": "sarah.chen@example.com",
  "patient_name": "Sarah Chen",
  "prescription_code": "RX-2026-001",
  "qr_image_url": "https://...",
  "pdf_file_url": "https://...",
  "status": "DRAFT",
  "created_at": "2026-04-22T00:00:00Z",
  "order_info": {
    "id": 1,
    "dentira_order_id": "0af60696-...",
    "status": "SHIPPED",
    "subtotal_cents": 27735,
    "tax_cents": 2704,
    "tracking_info": "https://fedex.com/track/...",
    "received_at": "...",
    "acknowledged_at": "...",
    "shipped_at": "...",
    "delivered_at": null
  }
}
```

---

## Webhook — Simulate Dentira Order (for testing)

```bash
# Simulate what Dentira Care POSTs when a patient places an order
curl -X POST http://localhost:3001/webhooks/dentira/orders \
  -H "Content-Type: application/json" \
  -d '{
    "order": {
      "id": "test-order-001",
      "status": "CREATED",
      "shippingMethod": "REGULAR",
      "createdAt": "2026-04-22T10:00:00Z",
      "orderDate": "2026-04-22T10:00:00Z",
      "orderCode": "ORDER-TEST01",
      "subTotal": 18999,
      "orderPayment": {
        "status": "PENDING",
        "subTotal": 18999,
        "total": 20852,
        "tax": null
      },
      "orderItems": [
        {
          "id": "item-001",
          "variantId": "V20010",
          "quantity": 1,
          "unitPrice": 18999,
          "prescriptionId": "abc-def-123",
          "status": "",
          "productVariant": {
            "id": "V20010",
            "concentration": "Braces Kit",
            "packaging": 1,
            "packagingUom": "Kit",
            "imageUrl": null,
            "product": {
              "name": "Braces Starter Collection",
              "manufacturerName": "OrthoNu"
            }
          }
        }
      ],
      "patient": {
        "name": "Sarah Chen",
        "email": "sarah.chen@example.com"
      },
      "shippingAddress": {
        "city": "Boston",
        "addressLine1": "123 Main St",
        "state": "Massachusetts",
        "country": "USA",
        "postalCode": "02101",
        "contactPhone": "6175550000"
      }
    }
  }'
```

**Response (200):**
```json
{
  "status": "accepted",
  "webhookLogId": 1
}
```

If `DEMO_MODE=true`, watch logs — SHIPPED fires at ~30s, DELIVERED at ~60s.

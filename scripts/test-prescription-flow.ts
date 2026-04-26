/**
 * End-to-end integration test against the Dentira Care sandbox.
 * Uses real variantId DN-ON-1004 (Chillin' Strips) confirmed by Deepankar on 2026-04-23.
 *
 * Run: pnpm test:dentira-prescription
 * Requires: DENTIRA_CLIENT_SECRET (and DATABASE_URL) in .env
 */
import 'dotenv/config';
import { pool } from '../src/db/pool.js';

const BASE_URL = process.env.DENTIRA_BASE_URL ?? 'https://vendor-care-sbx.dentira.com';
const CLIENT_ID = process.env.DENTIRA_CLIENT_ID ?? 'ortho_nu';
const CLIENT_SECRET = process.env.DENTIRA_CLIENT_SECRET ?? '';

const GRAPHQL_URL = `${BASE_URL}/graphql`;

// DN-ON-1004 = Chillin' Strips — first product with a confirmed real variantId
const TEST_VARIANT_ID = 'DN-ON-1004';
const TEST_PATIENT_EMAIL = 'test+orthonu@example.com';
const TEST_PATIENT_NAME = 'OrthoNu Test Patient';

const CREATE_PRESCRIPTION_MUTATION = /* GraphQL */ `
  mutation CreateTemplatePrescription($input: CreateTemplatePrescriptionInput!) {
    createTemplatePrescription(input: $input) {
      id
      patientEmail
      patientName
      prescriptionCode
      status
      qrImageUrl
      pdfFileUrl
      createdAt
    }
  }
`;

async function fetchToken(): Promise<string> {
  const res = await fetch(`${BASE_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      flow: 'CLIENT_CREDENTIALS',
    }),
  });

  if (!res.ok) {
    throw new Error(`Token fetch failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token?: string; accessToken?: string };
  const token = data.access_token ?? data.accessToken ?? '';
  if (!token) throw new Error(`Token response missing access_token: ${JSON.stringify(data)}`);
  return token;
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  OrthoNu × Dentira Care — Prescription Flow Integration Test');
  console.log('══════════════════════════════════════════════════════════════\n');

  let exitCode = 0;

  try {
    // ── Step 1: Fetch token ───────────────────────────────────────────────────
    console.log(`[1] Fetching sandbox token from ${BASE_URL}/auth/token ...`);
    const accessToken = await fetchToken();
    console.log(`    ✅ Token received (first 40 chars): ${accessToken.slice(0, 40)}...`);

    // ── Step 2: Call createTemplatePrescription with real variantId ───────────
    console.log(`\n[2] Calling createTemplatePrescription`);
    console.log(`    variantId  : ${TEST_VARIANT_ID} (Chillin' Strips — DN-ON-1004)`);
    console.log(`    patient    : ${TEST_PATIENT_NAME} <${TEST_PATIENT_EMAIL}>`);

    const gqlRes = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        query: CREATE_PRESCRIPTION_MUTATION,
        variables: {
          input: {
            patientEmail: TEST_PATIENT_EMAIL,
            patientName: TEST_PATIENT_NAME,
            notes: "OrthoNu test prescription — Chillin' Strips (DN-ON-1004)",
            prescriptionProducts: [
              {
                variantId: TEST_VARIANT_ID,
                dosage: 1,
                frequency: 1,
                duration: 14,
                takeWith: 'With Food',
                additionalNotes: '[FREQ_CODE:OD]',
                allowPackagingVariation: true,
                templateId: null,
              },
            ],
          },
        },
      }),
    });

    const gqlBody = (await gqlRes.json()) as {
      data?: { createTemplatePrescription: Record<string, unknown> };
      errors?: Array<{ message: string }>;
    };

    if (!gqlRes.ok || gqlBody.errors) {
      console.error(`\n❌ GraphQL call failed: HTTP ${gqlRes.status}`);
      console.error(JSON.stringify(gqlBody.errors ?? gqlBody, null, 2));
      process.exitCode = 1;
      return;
    }

    const rx = gqlBody.data!.createTemplatePrescription;

    console.log('\n    ✅ Prescription created:');
    console.log(`    prescription_id   : ${rx['id']}`);
    console.log(`    prescription_code : ${rx['prescriptionCode'] ?? rx['prescription_code'] ?? '(none)'}`);
    console.log(`    qr_image_url      : ${rx['qrImageUrl'] ?? rx['qr_image_url'] ?? '(none)'}`);
    console.log(`    pdf_file_url      : ${rx['pdfFileUrl'] ?? rx['pdf_file_url'] ?? '(none)'}`);
    console.log(`    status            : ${rx['status']}`);

    console.log('\n    Full response:');
    console.log(JSON.stringify(rx, null, 4));

    // ── Step 3: Persist to prescriptions table ────────────────────────────────
    console.log('\n[3] Persisting to prescriptions table ...');

    const prescriptionId = rx['id'] as string;
    const prescriptionCode = (rx['prescriptionCode'] ?? rx['prescription_code'] ?? null) as string | null;
    const qrImageUrl = (rx['qrImageUrl'] ?? rx['qr_image_url'] ?? null) as string | null;
    const pdfFileUrl = (rx['pdfFileUrl'] ?? rx['pdf_file_url'] ?? null) as string | null;
    const status = (rx['status'] ?? 'PENDING') as string;

    await pool.query(
      `INSERT INTO prescriptions
         (dentira_prescription_id, patient_email, patient_name, protocol_id,
          prescription_code, qr_image_url, pdf_file_url, status, raw_response_jsonb)
       VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8)
       ON CONFLICT (dentira_prescription_id) DO UPDATE
         SET status       = EXCLUDED.status,
             qr_image_url = EXCLUDED.qr_image_url,
             pdf_file_url = EXCLUDED.pdf_file_url`,
      [
        prescriptionId,
        TEST_PATIENT_EMAIL,
        TEST_PATIENT_NAME,
        prescriptionCode,
        qrImageUrl,
        pdfFileUrl,
        status,
        JSON.stringify(rx),
      ],
    );
    console.log(`    ✅ Persisted (prescription_id: ${prescriptionId})`);

  } catch (err) {
    console.error('\n❌ FAIL:', (err as Error).message);
    exitCode = 1;
  } finally {
    await pool.end();
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  if (exitCode === 0) {
    console.log('  RESULT: SUCCESS ✓');
  } else {
    console.log('  RESULT: FAIL ✗');
  }
  console.log('══════════════════════════════════════════════════════════════\n');

  process.exit(exitCode);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

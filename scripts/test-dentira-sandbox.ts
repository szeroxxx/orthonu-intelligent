/**
 * Integration test against the real Dentira Care sandbox.
 * Tests: token fetch → createTemplatePrescription (with placeholder V20010).
 *
 * Run: pnpm test:sandbox
 * Requires: DENTIRA_CLIENT_SECRET in .env
 */
import 'dotenv/config';

// NOTE: The auth spec says vendor-caresbx.dentira.com but that hostname doesn't resolve.
// The live sandbox is at vendor-care-sbx.dentira.com (confirmed via DNS + curl on 2026-04-22).
// The .env DENTIRA_BASE_URL should be set to https://vendor-care-sbx.dentira.com for now.
const BASE_URL = process.env.DENTIRA_BASE_URL ?? 'https://vendor-care-sbx.dentira.com';
const CLIENT_ID = process.env.DENTIRA_CLIENT_ID ?? 'ortho_nu';
const CLIENT_SECRET = process.env.DENTIRA_CLIENT_SECRET ?? '';

const GRAPHQL_URL = `${BASE_URL}/graphql`;

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

async function main() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  OrthoNu × Dentira Care — Sandbox Integration Test');
  console.log('══════════════════════════════════════════════════\n');

  // ── Step 1: Fetch access token ────────────────────────────────────────────
  console.log(`[1] Fetching token from ${BASE_URL}/auth/token ...`);

  const tokenRes = await fetch(`${BASE_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      flow: 'CLIENT_CREDENTIALS',
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error(`❌ Token fetch failed: ${tokenRes.status}\n${body}`);
    process.exit(1);
  }

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    accessToken?: string;
    token_type?: string;
    tokenType?: string;
    expires_in?: number;
    expiresIn?: number;
  };

  // Live sandbox returns camelCase; spec says snake_case
  const accessToken = tokenData.access_token ?? tokenData.accessToken ?? '';
  const tokenType = tokenData.token_type ?? tokenData.tokenType ?? 'Bearer';
  const expiresIn = tokenData.expires_in ?? tokenData.expiresIn ?? 0;

  if (!accessToken) {
    console.error('❌ Token response missing access_token:', JSON.stringify(tokenData));
    process.exit(1);
  }

  console.log('✅ Token received:');
  console.log(`   token_type : ${tokenType}`);
  console.log(`   expires_in : ${expiresIn}s`);
  console.log(`   access_token (first 40 chars): ${accessToken.slice(0, 40)}...`);

  // ── Step 2: Create a test prescription ───────────────────────────────────
  console.log('\n[2] Calling createTemplatePrescription with placeholder variantId V20010 ...');

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
          patientEmail: 'test-patient@orthonu-sandbox.com',
          patientName: 'OrthoNu Test Patient',
          notes: 'Sandbox integration test — CDT D8030 Braces Start',
          prescriptionProducts: [
            {
              allowPackagingVariation: true,
              templateId: null,
              variantId: 'V20010',
              dosage: 1,
              frequency: 1,
              duration: 14,
              takeWith: 'With Food',
              additionalNotes: '[FREQ_CODE:OD]',
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
    console.error(`❌ GraphQL call failed: ${gqlRes.status}`);
    console.error(JSON.stringify(gqlBody.errors ?? gqlBody, null, 2));
    process.exit(1);
  }

  const prescription = gqlBody.data?.createTemplatePrescription;

  console.log('\n✅ Prescription created successfully:');
  console.log(JSON.stringify(prescription, null, 2));

  console.log('\n══════════════════════════════════════════════════');
  console.log('  All sandbox checks passed ✓');
  console.log('══════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

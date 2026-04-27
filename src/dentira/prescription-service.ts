import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { NotFoundError, AppError } from '../lib/errors.js';
import { createTemplatePrescription } from './graphql-client.js';
import type { PrescriptionProductInput } from './types.js';

export interface CreatePrescriptionOptions {
  cdtCode: string;
  protocolIds?: number[];         // if caller already resolved protocol IDs
  patient: { name: string; email: string };
  notes?: string;
}

export interface PrescriptionResult {
  prescriptionId: string;
  prescriptionCode: string | null;
  qrImageUrl: string | null;
  pdfFileUrl: string | null;
}

// Frequency code used for all OrthoNu comfort products — once daily
const DEFAULT_FREQ_CODE = '[FREQ_CODE:OD]';

export async function createPrescription(
  opts: CreatePrescriptionOptions,
): Promise<PrescriptionResult> {
  const { cdtCode, patient, notes } = opts;

  // 1. Resolve protocols → products → variants for this CDT code
  const { rows: protocolRows } = await pool.query<{
    protocol_id: number;
    product_name: string;
    dentira_variant_id: string | null;
  }>(
    `SELECT p.id AS protocol_id, op.name AS product_name, dvm.dentira_variant_id
     FROM protocols p
     JOIN orthonu_products op   ON op.id = p.orthonu_product_id
     LEFT JOIN dentira_variant_map dvm ON dvm.orthonu_product_id = op.id
     WHERE p.cdt_code = $1 AND op.active = TRUE
     ORDER BY p.id`,
    [cdtCode],
  );

  if (protocolRows.length === 0) {
    throw new NotFoundError(`Protocol for CDT code ${cdtCode}`);
  }

  // 2. Build prescriptionProducts — skip products with no variantId (not yet confirmed by Deepankar)
  const prescriptionProducts: PrescriptionProductInput[] = [];
  const usedProtocolId = protocolRows[0].protocol_id;

  for (const row of protocolRows) {
    if (!row.dentira_variant_id) {
      logger.warn({ cdtCode, product: row.product_name }, 'No Dentira variantId mapped — skipping product');
      continue;
    }
    prescriptionProducts.push({
      variantId: row.dentira_variant_id,
      dosage: 1,
      frequency: 1,
      duration: 14,
      takeWith: 'With Food',
      additionalNotes: DEFAULT_FREQ_CODE,
      allowPackagingVariation: true,
      templateId: null,
    });
  }

  if (prescriptionProducts.length === 0) {
    throw new AppError(
      `No Dentira variantIds are mapped yet for CDT code ${cdtCode}. ` +
        'Contact Deepankar to confirm variantIds.',
      422,
      'NO_VARIANT_MAPPED',
    );
  }

  // 3. Call Dentira Care GraphQL
  logger.info({ cdtCode, productCount: prescriptionProducts.length }, 'Creating Dentira prescription');

  const rx = await createTemplatePrescription({
    patientEmail: patient.email,
    patientName: patient.name,
    notes: notes ?? `OrthoNu protocol for CDT ${cdtCode}`,
    prescriptionProducts,
  });

  // 4. Persist to prescriptions table
  await pool.query(
    `INSERT INTO prescriptions
       (dentira_prescription_id, patient_email, patient_name, protocol_id,
        prescription_code, qr_image_url, pdf_file_url, status, raw_response_jsonb)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (dentira_prescription_id) DO UPDATE
       SET status = EXCLUDED.status,
           qr_image_url = EXCLUDED.qr_image_url,
           pdf_file_url = EXCLUDED.pdf_file_url`,
    [
      rx.id,
      patient.email,
      patient.name,
      usedProtocolId,
      rx.prescriptionCode,
      rx.qrImageUrl,
      rx.pdfFileUrl,
      rx.status,
      JSON.stringify(rx),
    ],
  );

  logger.info({ dentiraPrescriptionId: rx.id }, 'Prescription persisted');

  return {
    prescriptionId: rx.id,
    prescriptionCode: rx.prescriptionCode,
    qrImageUrl: rx.qrImageUrl,
    pdfFileUrl: rx.pdfFileUrl,
  };
}

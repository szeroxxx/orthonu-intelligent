import { pool } from '../db/pool.js';

// Shape expected by the Chrome overlay POC (matches cdt-mapping-schema.json fields)
export interface ProtocolWithProduct {
  id: number;
  cdt_code: string;
  diagnosis: string;
  specialty: string;
  icd10_code: string | null;
  confidence_pct: number | null;
  trigger_condition: string | null;
  application_notes: string | null;
  follow_up_protocol: string | null;
  product: {
    id: number;
    name: string;
    sku: string;
    msrp_cents: number;
    dso_price_cents: number | null;
    dissolvable: boolean;
    category: string;
    description: string | null;
  };
  dentira_variant_id: string | null;
}

export async function getProtocolByCdt(cdtCode: string): Promise<ProtocolWithProduct[]> {
  const { rows } = await pool.query<ProtocolWithProduct>(
    `SELECT
       p.id,
       p.cdt_code,
       p.diagnosis,
       p.specialty,
       p.icd10_code,
       p.confidence_pct,
       p.trigger_condition,
       p.application_notes,
       p.follow_up_protocol,
       json_build_object(
         'id',             op.id,
         'name',           op.name,
         'sku',            op.sku,
         'msrp_cents',     op.msrp_cents,
         'dso_price_cents',op.dso_price_cents,
         'dissolvable',    op.dissolvable,
         'category',       op.category,
         'description',    op.description
       ) AS product,
       dvm.dentira_variant_id
     FROM protocols p
     JOIN orthonu_products op ON op.id = p.orthonu_product_id
     LEFT JOIN dentira_variant_map dvm ON dvm.orthonu_product_id = op.id
     WHERE p.cdt_code = $1 AND op.active = TRUE
     ORDER BY p.id`,
    [cdtCode],
  );

  return rows;
}

/** New export — used by Epic CDS decision engine for patient-view ICD-10 matching. */
export async function getProtocolsByIcd10(icd10Code: string): Promise<ProtocolWithProduct[]> {
  const { rows } = await pool.query<ProtocolWithProduct>(
    `SELECT
       p.id,
       p.cdt_code,
       p.diagnosis,
       p.specialty,
       p.icd10_code,
       p.confidence_pct,
       p.trigger_condition,
       p.application_notes,
       p.follow_up_protocol,
       json_build_object(
         'id',             op.id,
         'name',           op.name,
         'sku',            op.sku,
         'msrp_cents',     op.msrp_cents,
         'dso_price_cents',op.dso_price_cents,
         'dissolvable',    op.dissolvable,
         'category',       op.category,
         'description',    op.description
       ) AS product,
       dvm.dentira_variant_id
     FROM protocols p
     JOIN orthonu_products op ON op.id = p.orthonu_product_id
     LEFT JOIN dentira_variant_map dvm ON dvm.orthonu_product_id = op.id
     WHERE p.icd10_code = $1 AND op.active = TRUE
     ORDER BY p.id`,
    [icd10Code],
  );

  return rows;
}

export async function listAllProtocols(): Promise<ProtocolWithProduct[]> {
  const { rows } = await pool.query<ProtocolWithProduct>(
    `SELECT
       p.id,
       p.cdt_code,
       p.diagnosis,
       p.specialty,
       p.icd10_code,
       p.confidence_pct,
       p.trigger_condition,
       p.application_notes,
       p.follow_up_protocol,
       json_build_object(
         'id',             op.id,
         'name',           op.name,
         'sku',            op.sku,
         'msrp_cents',     op.msrp_cents,
         'dso_price_cents',op.dso_price_cents,
         'dissolvable',    op.dissolvable,
         'category',       op.category,
         'description',    op.description
       ) AS product,
       dvm.dentira_variant_id
     FROM protocols p
     JOIN orthonu_products op ON op.id = p.orthonu_product_id
     LEFT JOIN dentira_variant_map dvm ON dvm.orthonu_product_id = op.id
     WHERE op.active = TRUE
     ORDER BY p.cdt_code, p.id`,
  );

  return rows;
}

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies
vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}));

vi.mock('../../config/index.js', () => ({
  config: {
    DENTIRA_BASE_URL: 'https://vendor-caresbx.dentira.com',
    DENTIRA_CLIENT_ID: 'ortho_nu',
    DENTIRA_CLIENT_SECRET: 'test-secret',
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
  },
}));

vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })) },
}));

vi.mock('../graphql-client.js', () => ({
  createTemplatePrescription: vi.fn(),
}));

import { pool } from '../../db/pool.js';
import { createTemplatePrescription } from '../graphql-client.js';
import { createPrescription } from '../prescription-service.js';

const MOCK_RX_RESPONSE = {
  id: 'rx-abc-123',
  patientEmail: 'patient@example.com',
  patientName: 'Jane Doe',
  notes: 'OrthoNu protocol for CDT D8030',
  prescriptionCode: 'RX-2026-001',
  createdAt: '2026-04-22T00:00:00Z',
  status: 'DRAFT',
  qrImageUrl: 'https://example.com/qr.png',
  pdfFileUrl: 'https://example.com/rx.pdf',
  doctorId: 'doctor-1',
  patientId: null,
  prescriptionProducts: [],
};

describe('PrescriptionService.createPrescription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls GraphQL and persists prescription when variants are mapped', async () => {
    // Protocol rows query
    vi.mocked(pool.query)
      .mockResolvedValueOnce({
        rows: [
          { protocol_id: 1, product_name: 'Braces Starter Collection', dentira_variant_id: 'V-BRACE-001' },
          { protocol_id: 2, product_name: 'Comfort Tape', dentira_variant_id: 'V-TAPE-001' },
        ],
      } as never)
      // INSERT prescriptions
      .mockResolvedValueOnce({ rows: [] } as never);

    vi.mocked(createTemplatePrescription).mockResolvedValue(MOCK_RX_RESPONSE);

    const result = await createPrescription({
      cdtCode: 'D8030',
      patient: { name: 'Jane Doe', email: 'patient@example.com' },
      notes: 'Braces start',
    });

    expect(createTemplatePrescription).toHaveBeenCalledOnce();
    expect(createTemplatePrescription).toHaveBeenCalledWith(
      expect.objectContaining({
        patientEmail: 'patient@example.com',
        patientName: 'Jane Doe',
        prescriptionProducts: expect.arrayContaining([
          expect.objectContaining({ variantId: 'V-BRACE-001' }),
          expect.objectContaining({ variantId: 'V-TAPE-001' }),
        ]),
      }),
    );

    expect(result.prescriptionId).toBe('rx-abc-123');
    expect(result.qrImageUrl).toBe('https://example.com/qr.png');
  });

  it('throws NotFoundError when no protocols match the CDT code', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);

    await expect(
      createPrescription({ cdtCode: 'D9999', patient: { name: 'Test', email: 'test@test.com' } }),
    ).rejects.toThrow('not found');
  });

  it('throws AppError when all matched products have no variantId', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ protocol_id: 1, product_name: 'Braces Starter Collection', dentira_variant_id: null }],
    } as never);

    await expect(
      createPrescription({ cdtCode: 'D8030', patient: { name: 'Test', email: 'test@test.com' } }),
    ).rejects.toThrow('No Dentira variantIds are mapped yet');
  });
});

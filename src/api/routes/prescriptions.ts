import { Router, type IRouter } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { createPrescription } from '../../dentira/prescription-service.js';
import { pool } from '../../db/pool.js';
import { NotFoundError } from '../../lib/errors.js';

const router: IRouter = Router();

const createSchema = z.object({
  cdtCode: z.string().regex(/^D\d{4}$/, 'CDT code must be in format D1234'),
  patient: z.object({
    name: z.string().min(1),
    email: z.string().email(),
  }),
  notes: z.string().optional(),
  doctorId: z.string().optional(),
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const result = await createPrescription(body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id;

    // Support lookup by internal id or dentira_prescription_id
    const { rows } = await pool.query(
      `SELECT
         rx.id,
         rx.dentira_prescription_id,
         rx.patient_email,
         rx.patient_name,
         rx.prescription_code,
         rx.qr_image_url,
         rx.pdf_file_url,
         rx.status,
         rx.created_at,
         json_build_object(
           'id',             o.id,
           'dentira_order_id', o.dentira_order_id,
           'status',         o.status,
           'subtotal_cents', o.subtotal_cents,
           'tax_cents',      o.tax_cents,
           'tracking_info',  o.tracking_info,
           'received_at',    o.received_at,
           'acknowledged_at',o.acknowledged_at,
           'shipped_at',     o.shipped_at,
           'delivered_at',   o.delivered_at
         ) AS order_info
       FROM prescriptions rx
       LEFT JOIN orders o ON o.prescription_id = rx.id
       WHERE rx.id = $1 OR rx.dentira_prescription_id = $1
       LIMIT 1`,
      [id],
    );

    if (rows.length === 0) {
      throw new NotFoundError('Prescription');
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;

import { Router } from 'express';
import { pool } from './db';
import { z } from 'zod';
import { getAvailability } from './scheduling';
import { createAppointment } from './booking';

export const router = Router();

router.get('/v1/staff', async (req, res) => {
  const tenantId = (req as any).tenantId;
  const { rows } = await pool.query(
    'select id,name,color,active,skills from public.staff where tenant_id = $1',
    [tenantId]
  );
  res.json(rows);
});

router.get('/v1/services', async (req, res) => {
  const tenantId = (req as any).tenantId;
  const { rows } = await pool.query(
    'select id,name,duration_min,prep_min,cleanup_min,price from public.services where tenant_id = $1',
    [tenantId]
  );
  res.json(rows);
});

// availability (GET with query params)
router.get('/v1/availability', async (req, res) => {
  const schema = z.object({
    service_id: z.string(),
    date_from: z.string(),
    date_to: z.string(),
    preferred_staff: z.string().optional()
  });
  const q = schema.safeParse({
    service_id: req.query.service_id,
    date_from: req.query.date_from,
    date_to: req.query.date_to,
    preferred_staff: req.query.preferred_staff
  });
  if (!q.success) return res.status(400).json(q.error.flatten());
  const slots = await getAvailability({
    tenantId: (req as any).tenantId,
    serviceId: q.data.service_id,
    dateFrom: q.data.date_from,
    dateTo: q.data.date_to,
    preferredStaffIds: q.data.preferred_staff?.split(',') ?? []
  });
  res.json(slots);
});

// availability (POST with JSON body)
router.post('/v1/availability', async (req, res) => {
  const schema = z.object({
    service_id: z.string(),
    date_range: z.object({ from: z.string(), to: z.string() }),
    preferred_staff: z.array(z.string()).optional(),
    limit: z.number().optional()
  });
  const body = schema.safeParse(req.body);
  if (!body.success) return res.status(400).json(body.error.flatten());
  const slots = await getAvailability({
    tenantId: (req as any).tenantId,
    serviceId: body.data.service_id,
    dateFrom: body.data.date_range.from,
    dateTo: body.data.date_range.to,
    preferredStaffIds: body.data.preferred_staff
  });
  res.json(slots);
});

// booking endpoints
router.post('/v1/appointments', async (req, res) => {
  const schema = z.object({
    client: z.object({ id: z.string().optional(), name: z.string().optional(), phone: z.string().optional() }),
    service_id: z.string(),
    staff_id: z.string().optional(),
    start_ts: z.string(),
    source: z.string().optional()
  });
  const idemKey = req.header('Idempotency-Key') ?? undefined;
  const body = schema.safeParse(req.body);
  if (!body.success) return res.status(400).json(body.error.flatten());

  try {
    const out = await createAppointment({
      tenantId: (req as any).tenantId,
      client: body.data.client,
      serviceId: body.data.service_id,
      staffId: body.data.staff_id,
      startTs: body.data.start_ts,
      source: body.data.source,
      idemKey
    });
    if ((out as any).duplicate) return res.status(409).json({ duplicate: true });
    res.json(out);
  } catch (e: any) {
    res.status(409).json({ error: e.message });
  }
});

router.post('/v1/appointments/:id/cancel', async (req, res) => {
  res.status(501).json({ error: 'not implemented' });
});
router.post('/v1/appointments/:id/reschedule', async (req, res) => {
  res.status(501).json({ error: 'not implemented' });
});

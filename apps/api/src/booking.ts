import { pool } from './db';
import type { PoolClient } from 'pg';
import crypto from 'crypto';

async function withTxn<T>(fn: (c: PoolClient)=>Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin isolation level serializable');
    const result = await fn(c);
    await c.query('commit');
    return result;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

export async function createAppointment(params: {
  tenantId: string;
  client: { id?: string; name?: string; phone?: string };
  serviceId: string;
  staffId?: string;
  startTs: string; // ISO
  source?: string;
  idemKey?: string;
}) {
  return withTxn(async (c) => {
    // idempotency (simple example table)
    await c.query(`
      create table if not exists public.idempotency_keys(
        key_hash text primary key,
        created_at timestamptz default now()
      );
    `);

    const keyHash = params.idemKey ? crypto.createHash('sha256').update(params.idemKey).digest('hex') : null;
    if (keyHash) {
      const ins = await c.query('insert into public.idempotency_keys(key_hash) values ($1) on conflict do nothing', [keyHash]);
      if (ins.rowCount === 0) {
        // duplicate
        return { duplicate: true };
      }
    }

    // lock staff window (advisory lock using staff hash)
    const staffId = params.staffId!;
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`${params.tenantId}:${staffId}:${params.startTs}`]);

    // load service duration
    const svc = await c.query(
      'select duration_min, prep_min, cleanup_min from public.services where id=$1 and tenant_id=$2',
      [params.serviceId, params.tenantId]
    );
    if (svc.rowCount === 0) throw new Error('service not found');
    const { duration_min, prep_min, cleanup_min } = svc.rows[0] as any;
    const totalMin = duration_min + prep_min + cleanup_min;

    // compute end
    const start = new Date(params.startTs);
    const end = new Date(start.getTime() + totalMin * 60000);

    // ensure no overlap (DB constraint + explicit check)
    const overlap = await c.query(`
      select 1
      from public.appointment_items ai
      join public.appointments a on a.id = ai.appointment_id
      where a.tenant_id=$1 and ai.staff_id=$2
        and tstzrange(ai.start_ts, ai.end_ts) && tstzrange($3::timestamptz, $4::timestamptz)
      limit 1
    `, [params.tenantId, staffId, start.toISOString(), end.toISOString()]);
    if (overlap.rowCount > 0) throw new Error('overlap');

    // upsert client (simplified)
    let clientId = params.client.id;
    if (!clientId) {
      const cli = await c.query(
        'insert into public.clients(id,tenant_id,name,phone) values (gen_random_uuid(),$1,$2,$3) returning id',
        [params.tenantId, params.client.name ?? 'Guest', params.client.phone ?? null]
      );
      clientId = cli.rows[0].id;
    }

    // create appointment + item
    const appt = await c.query(
      `insert into public.appointments(id,tenant_id,client_id,start_ts,end_ts,status,source)
       values (gen_random_uuid(),$1,$2,$3,$4,'confirmed',$5) returning id`,
      [params.tenantId, clientId, start.toISOString(), end.toISOString(), params.source ?? 'api']
    );
    const apptId = appt.rows[0].id;

    await c.query(
      `insert into public.appointment_items(id,appointment_id,service_id,staff_id,start_ts,end_ts,tenant_id)
       values (gen_random_uuid(),$1,$2,$3,$4,$5,$6)`,
      [apptId, params.serviceId, staffId, start.toISOString(), end.toISOString(), params.tenantId]
    );

    return { id: apptId, start_ts: start.toISOString(), end_ts: end.toISOString() };
  });
}

import { pool } from './db';
import { DateTime, Interval } from 'luxon';

type Slot = { staff_id: string; start_ts: string; end_ts: string; reason: 'gap_fill' | 'best_fit' | 'staff_pref' };

type Shift = { staff_id: string; weekday: number; start_time: string; end_time: string };

type TimeOff = { staff_id: string; start_ts: string; end_ts: string };

type Item = { staff_id: string; start_ts: string; end_ts: string };

function* iterateByMinutes(start: DateTime, end: DateTime, stepMin: number) {
  let t = start;
  while (t <= end) {
    yield t;
    t = t.plus({ minutes: stepMin });
  }
}

function subtractIntervals(base: Interval[], cutters: Interval[]): Interval[] {
  // subtract each cutter from the base set
  let result = base.slice();
  for (const c of cutters) {
    const next: Interval[] = [];
    for (const b of result) {
      if (!b.overlaps(c)) {
        next.push(b);
        continue;
      }
      const parts = b.difference(c);
      for (const p of parts) next.push(p);
    }
    result = next;
  }
  // normalize (merge touching)
  result.sort((a, b) => a.start.toMillis() - b.start.toMillis());
  const merged: Interval[] = [];
  for (const r of result) {
    const last = merged[merged.length - 1];
    if (last && last.end.equals(r.start)) merged[merged.length - 1] = Interval.fromDateTimes(last.start, r.end);
    else merged.push(r);
  }
  return merged;
}

function totalDurationMinutes(service: { duration_min: number; prep_min: number; cleanup_min: number }): number {
  return service.duration_min + service.prep_min + service.cleanup_min;
}

export async function getAvailability(params: {
  tenantId: string;
  serviceId: string;
  preferredStaffIds?: string[];
  dateFrom: string; // ISO date (YYYY-MM-DD)
  dateTo: string; // ISO date (YYYY-MM-DD)
  granularityMin?: number; // default 10
}): Promise<Slot[]> {
  const granularityMin = params.granularityMin ?? 10;

  // Load tenant time zone
  const tenantRes = await pool.query('select tenant_time_zone from public.tenants where id = $1', [params.tenantId]);
  if (tenantRes.rowCount === 0) return [];
  const tenantTz = tenantRes.rows[0].tenant_time_zone as string;

  // Load service
  const svcRes = await pool.query(
    'select duration_min, prep_min, cleanup_min from public.services where id = $1 and tenant_id = $2',
    [params.serviceId, params.tenantId]
  );
  if (svcRes.rowCount === 0) return [];
  const service = svcRes.rows[0] as { duration_min: number; prep_min: number; cleanup_min: number };
  const requiredMinutes = totalDurationMinutes(service);

  // Determine staff
  const preferredSet = new Set((params.preferredStaffIds ?? []).filter(Boolean));
  const staffRes = await pool.query('select id from public.staff where tenant_id = $1 and active = true', [params.tenantId]);
  let staffIds: string[] = staffRes.rows.map((r) => r.id as string);
  if (preferredSet.size > 0) {
    staffIds = staffIds.filter((id) => preferredSet.has(id));
    if (staffIds.length === 0) return [];
  }

  // Date range in tenant TZ
  const rangeStart = DateTime.fromISO(params.dateFrom, { zone: tenantTz }).startOf('day');
  const rangeEnd = DateTime.fromISO(params.dateTo, { zone: tenantTz }).endOf('day');

  // Load shifts for tenant/staff
  const shiftsRes = await pool.query(
    'select staff_id, weekday, start_time::text as start_time, end_time::text as end_time from public.shifts where tenant_id = $1 and staff_id = any($2::uuid[])',
    [params.tenantId, staffIds]
  );
  const shifts: Shift[] = shiftsRes.rows as any;

  // Load time off within window (overlap)
  const toffRes = await pool.query(
    `select staff_id, start_ts::timestamptz as start_ts, end_ts::timestamptz as end_ts
     from public.time_off
     where tenant_id = $1
       and staff_id = any($2::uuid[])
       and start_ts < $4::timestamptz and end_ts > $3::timestamptz`,
    [params.tenantId, staffIds, rangeStart.toUTC().toISO(), rangeEnd.toUTC().toISO()]
  );
  const timeOff: TimeOff[] = toffRes.rows as any;

  // Load appointment items overlapping window
  const itemsRes = await pool.query(
    `select staff_id, start_ts::timestamptz as start_ts, end_ts::timestamptz as end_ts
     from public.appointment_items
     where tenant_id = $1
       and staff_id = any($2::uuid[])
       and start_ts < $4::timestamptz and end_ts > $3::timestamptz`,
    [params.tenantId, staffIds, rangeStart.toUTC().toISO(), rangeEnd.toUTC().toISO()]
  );
  const items: Item[] = itemsRes.rows as any;

  // Build day list
  const days: DateTime[] = [];
  for (let d = rangeStart.startOf('day'); d <= rangeEnd; d = d.plus({ days: 1 })) {
    days.push(d);
  }

  const slots: Slot[] = [];

  for (const staffId of staffIds) {
    // Pre-group intervals to subtract
    const staffTimeOffIntervals = timeOff
      .filter((t) => t.staff_id === staffId)
      .map((t) => Interval.fromDateTimes(DateTime.fromISO(t.start_ts), DateTime.fromISO(t.end_ts)));
    const staffItemIntervals = items
      .filter((i) => i.staff_id === staffId)
      .map((i) => Interval.fromDateTimes(DateTime.fromISO(i.start_ts), DateTime.fromISO(i.end_ts)));

    for (const day of days) {
      const weekday = day.weekday % 7; // Luxon: Monday=1..Sunday=7 → use 0..6 with Sunday=0
      const normalizedWeekday = weekday === 7 ? 0 : weekday; // actually weekday can't be 7 after %7; safeguard

      const todaysShifts = shifts.filter((s) => s.staff_id === staffId && s.weekday === normalizedWeekday);
      if (todaysShifts.length === 0) continue;

      const baseIntervals: Interval[] = todaysShifts
        .map((s) => {
          // Combine local date with shift times in tenant TZ
          const startLocal = DateTime.fromISO(`${day.toFormat('yyyy-LL-dd')}T${s.start_time}`, { zone: tenantTz });
          const endLocal = DateTime.fromISO(`${day.toFormat('yyyy-LL-dd')}T${s.end_time}`, { zone: tenantTz });
          if (!startLocal.isValid || !endLocal.isValid) return null;
          if (endLocal <= startLocal) return null; // ignore overnight for v1
          return Interval.fromDateTimes(startLocal, endLocal);
        })
        .filter((x): x is Interval => Boolean(x));

      if (baseIntervals.length === 0) continue;

      // Subtract time off and existing items
      let freeIntervals = subtractIntervals(baseIntervals, staffTimeOffIntervals);
      freeIntervals = subtractIntervals(freeIntervals, staffItemIntervals);

      // From free intervals, generate candidate start times by granularity
      for (const free of freeIntervals) {
        // shrink by service duration so that end fits in interval
        const latestStart = free.end.minus({ minutes: requiredMinutes });
        if (latestStart <= free.start) continue;

        for (const t of iterateByMinutes(free.start, latestStart, granularityMin)) {
          const end = t.plus({ minutes: requiredMinutes });
          // produce slot in UTC ISO
          const reason: Slot['reason'] = preferredSet.size > 0 && preferredSet.has(staffId) ? 'staff_pref' : 'best_fit';
          slots.push({
            staff_id: staffId,
            start_ts: t.toUTC().toISO(),
            end_ts: end.toUTC().toISO(),
            reason,
          });
        }
      }
    }
  }

  // Optional: sort by start then staff
  slots.sort((a, b) => (a.start_ts < b.start_ts ? -1 : a.start_ts > b.start_ts ? 1 : a.staff_id.localeCompare(b.staff_id)));

  return slots;
}

import 'dotenv/config';
import { pool } from '../src/db';

async function main() {
  const { rows } = await pool.query(`insert into public.tenants(id,name,tenant_time_zone)
    values (gen_random_uuid(),'Demo Studio','Asia/Makassar') returning id`);
  const tenantId = rows[0].id;

  // 5 staff
  const staffRes = await pool.query(`
    insert into public.staff(id,tenant_id,name,color,skills) values
    (gen_random_uuid(),$1,'Anna','#F87171','["nails"]'::jsonb),
    (gen_random_uuid(),$1,'Bella','#60A5FA','["nails","pedicure"]'::jsonb),
    (gen_random_uuid(),$1,'Cara','#34D399','["nails"]'::jsonb),
    (gen_random_uuid(),$1,'Dina','#FBBF24','["nails","extensions"]'::jsonb),
    (gen_random_uuid(),$1,'Ella','#A78BFA','["nails"]'::jsonb)
    returning id
  `,[tenantId]);
  const staffIds: string[] = staffRes.rows.map(r=>r.id);

  // 20 services (short sample)
  await pool.query(`
    insert into public.services(id,tenant_id,name,duration_min,prep_min,cleanup_min,price) values
    (gen_random_uuid(),$1,'Classic Manicure',45,5,5,150000),
    (gen_random_uuid(),$1,'Gel Manicure',60,5,10,250000),
    (gen_random_uuid(),$1,'Pedicure',60,5,10,250000)
  `,[tenantId]);

  // Weekday shifts 09:00-17:00 for each staff (Mon-Fri)
  const weekdays = [1,2,3,4,5];
  for (const sid of staffIds) {
    for (const wd of weekdays) {
      await pool.query(
        `insert into public.shifts(id,tenant_id,staff_id,weekday,start_time,end_time)
         values (gen_random_uuid(),$1,$2,$3,'09:00','17:00')`,
        [tenantId, sid, wd]
      );
    }
  }

  console.log('Seeded tenant:', tenantId);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

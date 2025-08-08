import 'dotenv/config';
import { pool } from '../src/db';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

async function run() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const migrationsDir = path.resolve(__dirname, '../../../db/migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const f of files) {
    const full = path.join(migrationsDir, f);
    const sql = fs.readFileSync(full, 'utf8');
    process.stdout.write(`Applying ${f}... `);
    await pool.query('begin');
    try {
      await pool.query(sql);
      await pool.query('commit');
      console.log('done');
    } catch (e) {
      await pool.query('rollback');
      console.error(`failed: ${(e as Error).message}`);
      throw e;
    }
  }
  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

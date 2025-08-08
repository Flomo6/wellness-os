import { Pool } from 'pg';
import { CONFIG } from './config';

export const pool = new Pool({ connectionString: CONFIG.DATABASE_URL });

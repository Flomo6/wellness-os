import 'dotenv/config';

export const CONFIG = {
  PORT: Number(process.env.PORT ?? 8787),
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  RATE_POINTS: 100,
  RATE_DURATION_S: 60
};

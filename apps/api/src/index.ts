import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import cors from 'cors';
import { router } from './routes';
import { requireTenantKey } from './security';
import { CONFIG } from './config';

const app = express();
const logger = pino();
app.use(pinoHttp({ logger }));
app.use(helmet());
app.use(cors({
  origin: [/^http:\/\/localhost:\d+$/],
  credentials: false,
  allowedHeaders: ['Content-Type', 'X-Tenant-Key', 'X-Bot-Token', 'X-Tenant-Id', 'Idempotency-Key'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use(requireTenantKey, router);

app.listen(CONFIG.PORT, () => logger.info({ port: CONFIG.PORT }, 'API up'));

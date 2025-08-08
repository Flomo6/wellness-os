import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { router } from './routes';
import { requireTenantKey } from './security';
import { CONFIG } from './config';

const app = express();
const logger = pino();
app.use(pinoHttp({ logger }));
app.use(helmet());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use(requireTenantKey, router);

app.listen(CONFIG.PORT, () => logger.info({ port: CONFIG.PORT }, 'API up'));

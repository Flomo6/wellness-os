import { Request, Response, NextFunction } from 'express';

export function requireTenantKey(req: Request, res: Response, next: NextFunction) {
  const tenantKey = req.header('X-Tenant-Key');
  const botToken = req.header('X-Bot-Token');
  if (!tenantKey || !botToken) return res.status(401).json({ error: 'missing credentials' });
  // TODO: verify against tenant_api_keys and bot token table
  (req as any).tenantId = (req.header('X-Tenant-Id') ?? '').trim(); // temporary until lookup
  return next();
}

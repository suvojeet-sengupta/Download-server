import { Router } from 'express';
import { checkHealth } from '../db/database';

export const healthRouter = Router();

/**
 * Container healthcheck target. Unauthenticated on purpose, and it asserts the
 * index is readable and the data directories are writable rather than only that
 * the port is open - a broken mount must surface as "unhealthy" instead of
 * failing silently on the next upload.
 */
healthRouter.get('/healthz', (_req, res) => {
  try {
    const { items } = checkHealth();
    res.json({ status: 'ok', items, uptime: Math.round(process.uptime()) });
  } catch (error) {
    res.status(503).json({ status: 'error', error: (error as Error).message });
  }
});

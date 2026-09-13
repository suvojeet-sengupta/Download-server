import type { NextFunction, Request, Response } from 'express';
import { config } from '../config/env';

/**
 * Single shared credential, accepted as the x-password header or a ?password
 * query parameter. Guards uploads and management only: /d/:id downloads stay
 * public by design.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['x-password'];
  const query = req.query.password;
  const supplied = typeof header === 'string' ? header : typeof query === 'string' ? query : '';

  if (!supplied || supplied !== config.password) {
    res.status(401).json({ error: 'Unauthorized: Invalid password.' });
    return;
  }
  next();
}

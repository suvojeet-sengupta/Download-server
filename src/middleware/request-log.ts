import type { NextFunction, Request, Response } from 'express';

const MUTATIONS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Logs every state-changing request with its outcome and caller address.
 *
 * Reads are deliberately not logged: they are high volume and low value. What
 * matters is being able to answer "what removed this file, and when" after the
 * fact - previously there was no record of that at all.
 */
export function requestLog(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATIONS.has(req.method)) {
    next();
    return;
  }

  const started = Date.now();
  res.on('finish', () => {
    const ip =
      (req.headers['cf-connecting-ip'] as string) ||
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      '-';
    const detail = req.path === '/api/files/delete' ? ` ids=${JSON.stringify(req.body?.ids ?? [])}` : '';
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ` +
        `${res.statusCode} ${Date.now() - started}ms ip=${ip}${detail}`,
    );
  });

  next();
}

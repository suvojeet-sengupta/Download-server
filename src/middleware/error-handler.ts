import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';

/**
 * Terminal error handler. Express 5 forwards rejected async handlers here
 * automatically, which is why route bodies no longer need try/catch purely to
 * avoid an unhandled rejection.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    res.status(status).json({ error: `Upload rejected: ${err.message}` });
    return;
  }

  console.error('Unhandled request error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

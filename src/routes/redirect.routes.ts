import { Router, type Request, type Response } from 'express';
import { SHORT_PREFIX, consumeClick } from '../services/shortlink.service';
import { errorPage } from '../utils/http';

export const redirectRouter = Router();

function redirect(req: Request, res: Response): boolean {
  const link = consumeClick(req.params.code as string);
  if (!link) {
    res
      .status(404)
      .send(
        errorPage(
          '404 - Link Not Found',
          'The shortened link you are trying to access does not exist or has been deleted.',
        ),
      );
    return false;
  }
  res.redirect(link.longUrl);
  return true;
}

/** Legacy short-link shape, kept working for links already in the wild. */
redirectRouter.get('/s/:code', (req, res) => {
  redirect(req, res);
});

/**
 * Root-level short links. Registered last and scoped to the "suvo" prefix so it
 * can never shadow a real page or static asset; anything else falls through.
 */
redirectRouter.get('/:code', (req, res, next) => {
  if (!req.params.code.startsWith(SHORT_PREFIX)) {
    next();
    return;
  }
  redirect(req, res);
});

import { Router } from 'express';
import { authRouter } from './auth.routes';
import { downloadRouter } from './download.routes';
import { filesRouter } from './files.routes';
import { healthRouter } from './health.routes';
import { redirectRouter } from './redirect.routes';
import { shortenRouter } from './shorten.routes';
import { uploadRouter } from './upload.routes';
import { zipRouter } from './zip.routes';

export const apiRouter = Router();

/**
 * Mount order matters: the root-level short-link catch-all in redirectRouter
 * must come last so it cannot shadow a real route.
 */
apiRouter.use(healthRouter);
apiRouter.use(authRouter);
apiRouter.use(uploadRouter);
apiRouter.use(filesRouter);
apiRouter.use(shortenRouter);
apiRouter.use(zipRouter);
apiRouter.use(downloadRouter);
apiRouter.use(redirectRouter);

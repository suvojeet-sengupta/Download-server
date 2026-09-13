import express, { type Express } from 'express';
import { PUBLIC_DIR } from './config/paths';
import { errorHandler } from './middleware/error-handler';
import { apiRouter } from './routes';

/**
 * Builds the Express application. Kept separate from the listener so tests can
 * mount it without binding a port.
 */
export function createApp(): Express {
  const app = express();

  // Trust the proxy hop so req.protocol reflects the original scheme when the
  // app sits behind a reverse proxy or tunnel.
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(express.json());

  // Static assets are served before the routers so the root-level short-link
  // catch-all can never shadow a real file.
  app.use(express.static(PUBLIC_DIR));
  app.get('/', (_req, res) => {
    res.sendFile('index.html', { root: PUBLIC_DIR });
  });

  app.use(apiRouter);
  app.use(errorHandler);

  return app;
}

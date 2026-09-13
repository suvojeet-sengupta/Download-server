import { config } from './config/env';
import { ensureDirectories } from './config/paths';
import { migrateLegacyDatabase, reindexOrphanUploads } from './db/database';
import { createApp } from './app';

/**
 * Startup order is deliberate: create the persistent directories, pull forward
 * any legacy index, recover uploads that exist on disk but are missing from the
 * index, and only then accept traffic.
 */
function bootstrap(): void {
  ensureDirectories();
  migrateLegacyDatabase();
  reindexOrphanUploads();

  const app = createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`SuvShare server listening at http://0.0.0.0:${config.port}`);
  });

  // Let the container stop cleanly instead of being killed after the timeout.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      console.log(`Received ${signal}, shutting down.`);
      server.close(() => process.exit(0));
    });
  }
}

bootstrap();

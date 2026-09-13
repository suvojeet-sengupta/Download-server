import fs from 'node:fs';
import path from 'node:path';

/**
 * Project root. npm scripts always run from the package directory and the
 * container sets WORKDIR=/app, so cwd is the reliable anchor for both
 * `tsx src/index.ts` and `node dist/index.js`.
 */
export const ROOT_DIR = process.env.APP_ROOT ?? process.cwd();

export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

/**
 * Persistent locations. Both are plain DIRECTORIES so a bind mount on a fresh
 * host always works: Docker creates a missing mount source as a directory. The
 * index lives *inside* DATA_DIR and is never bind mounted as a single file -
 * doing that is what produced the historical EISDIR outage.
 */
export const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.join(ROOT_DIR, 'uploads');
export const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT_DIR, 'data');

export const TEMP_DIR = path.join(UPLOADS_DIR, 'temp');
export const MULTER_TEMP_DIR = path.join(UPLOADS_DIR, 'multer_temp');

export const DB_FILE = path.join(DATA_DIR, 'db.json');

/** Pre-DATA_DIR deployments kept the index here. Migrated on startup. */
export const LEGACY_DB_FILE = path.join(ROOT_DIR, 'db.json');

export function ensureDirectories(): void {
  for (const dir of [UPLOADS_DIR, DATA_DIR, TEMP_DIR, MULTER_TEMP_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

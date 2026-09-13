import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config/env';
import { MULTER_TEMP_DIR, TEMP_DIR, UPLOADS_DIR } from '../config/paths';
import type { UploadMeta } from '../types/domain';
import { newTempName } from '../utils/ids';

/**
 * Incoming bodies land in a scratch directory under an opaque name, then get
 * renamed into place. Keeping the temp dir on the same filesystem as uploads/
 * makes that rename atomic instead of a copy.
 */
export const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      if (!fs.existsSync(MULTER_TEMP_DIR)) fs.mkdirSync(MULTER_TEMP_DIR, { recursive: true });
      cb(null, MULTER_TEMP_DIR);
    },
    filename: (_req, _file, cb) => cb(null, newTempName()),
  }),
  limits: { fileSize: config.maxUploadBytes },
});

export function sessionDir(uploadId: string): string {
  return path.join(TEMP_DIR, uploadId);
}

function metaPath(uploadId: string): string {
  return path.join(sessionDir(uploadId), 'meta.json');
}

export function readMeta(uploadId: string): UploadMeta | null {
  const file = metaPath(uploadId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as UploadMeta;
  } catch {
    return null;
  }
}

export function writeMeta(meta: UploadMeta): void {
  fs.mkdirSync(sessionDir(meta.uploadId), { recursive: true });
  fs.writeFileSync(metaPath(meta.uploadId), JSON.stringify(meta, null, 2));
}

export function chunkPath(uploadId: string, index: number): string {
  return path.join(sessionDir(uploadId), `chunk_${index}`);
}

/**
 * Resume support: a client re-announcing the same fingerprint is handed back
 * its existing session instead of restarting the transfer.
 */
export function findSessionByFingerprint(
  fingerprint: string,
): { uploadId: string; meta: UploadMeta } | null {
  if (!fs.existsSync(TEMP_DIR)) return null;
  for (const folder of fs.readdirSync(TEMP_DIR)) {
    const meta = readMeta(folder);
    if (meta && meta.fingerprint === fingerprint) return { uploadId: folder, meta };
  }
  return null;
}

/** Index of the first chunk not yet on disk. */
export function nextMissingChunk(uploadId: string): number {
  let index = 0;
  while (fs.existsSync(chunkPath(uploadId, index))) index++;
  return index;
}

export function hasAllChunks(uploadId: string, totalChunks: number): boolean {
  for (let i = 0; i < totalChunks; i++) {
    if (!fs.existsSync(chunkPath(uploadId, i))) return false;
  }
  return true;
}

/** Where a completed transfer should land. Folder members keep their tree. */
export function resolveFinalPath(meta: UploadMeta, uploadId: string): string {
  if (meta.folderId && meta.relativePath) {
    return path.join(UPLOADS_DIR, meta.folderId, meta.relativePath);
  }
  return path.join(UPLOADS_DIR, uploadId, meta.name);
}

/**
 * Concatenate chunks in order, deleting each one as it is consumed so a large
 * transfer never needs double the disk space. Streams sequentially rather than
 * buffering, so memory stays flat regardless of file size.
 */
export async function mergeChunks(
  uploadId: string,
  meta: UploadMeta,
  finalPath: string,
): Promise<void> {
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  const output = fs.createWriteStream(finalPath);

  try {
    for (let i = 0; i < meta.totalChunks; i++) {
      const part = chunkPath(uploadId, i);
      await new Promise<void>((resolve, reject) => {
        const input = fs.createReadStream(part);
        input.on('error', reject);
        output.on('error', reject);
        input.on('end', () => resolve());
        input.pipe(output, { end: false });
      });
      try {
        fs.unlinkSync(part);
      } catch {
        /* already gone */
      }
    }
  } catch (error) {
    output.destroy();
    throw error;
  }

  await new Promise<void>((resolve, reject) => {
    output.on('finish', () => resolve());
    output.on('error', reject);
    output.end();
  });
}

/** Drops the session scratch directory once its chunks are merged. */
export function cleanupSession(uploadId: string): void {
  try {
    fs.rmSync(sessionDir(uploadId), { recursive: true, force: true });
  } catch (error) {
    console.error('Error cleaning up temp directory:', error);
  }
}

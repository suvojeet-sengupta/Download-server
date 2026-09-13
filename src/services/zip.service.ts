import fs from 'node:fs';
import { ZipArchive } from 'archiver';
import { config } from '../config/env';
import { readDatabase, writeDatabase } from '../db/database';
import type { StoredItem, ZipTask } from '../types/domain';
import { itemDir, zipPath } from './storage.service';

/**
 * In-memory progress registry for folder ZIP builds. Deliberately not
 * persisted: a restart loses progress, but the finished .zip on disk is what
 * actually matters and is detected on the next status poll.
 */
const tasks = new Map<string, ZipTask>();

export function getTask(id: string): ZipTask | undefined {
  return tasks.get(id);
}

export function isZipping(id: string): boolean {
  return tasks.get(id)?.status === 'zipping';
}

export function zipExists(id: string): boolean {
  return fs.existsSync(zipPath(id));
}

export function downloadPath(id: string): string {
  return `/api/zip/download/${id}`;
}

/**
 * Starts a background archive build. Returns immediately; callers poll
 * /api/zip/status/:id. The download counter is incremented once the archive
 * finishes, matching the previous behaviour.
 */
export function startZip(item: StoredItem): void {
  const target = zipPath(item.id);
  tasks.set(item.id, { status: 'zipping', progress: 0, total: item.size });

  const output = fs.createWriteStream(target);
  const archive = new ZipArchive({ zlib: { level: config.zipCompressionLevel } });

  output.on('close', () => {
    tasks.set(item.id, {
      status: 'done',
      progress: 100,
      total: item.size,
      url: downloadPath(item.id),
    });

    const db = readDatabase();
    const record = db.files.find((f) => f.id === item.id);
    if (record) {
      record.downloads += 1;
      writeDatabase(db);
    }
  });

  archive.on('error', (error: Error) => {
    tasks.set(item.id, { status: 'error', error: error.message });
    console.error(`ZIP build failed for ${item.id}:`, error);
  });

  archive.on('progress', (data: { fs: { processedBytes: number } }) => {
    const current = tasks.get(item.id);
    if (current?.status === 'zipping') {
      tasks.set(item.id, { ...current, progress: data.fs.processedBytes });
    }
  });

  archive.pipe(output);
  archive.directory(itemDir(item.id), false);
  void archive.finalize();
}

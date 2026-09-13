import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, DB_FILE, LEGACY_DB_FILE, UPLOADS_DIR } from '../config/paths';
import type { Database, StoredFile, StoredItem } from '../types/domain';

const EMPTY: Database = { files: [], links: [] };

/** Directory names inside uploads/ that are scratch space, never share ids. */
const RESERVED_DIRS = new Set(['temp', 'multer_temp']);

function normalize(raw: unknown): Database {
  if (typeof raw !== 'object' || raw === null) return { files: [], links: [] };
  const candidate = raw as Partial<Database>;
  return {
    files: Array.isArray(candidate.files) ? candidate.files : [],
    links: Array.isArray(candidate.links) ? candidate.links : [],
  };
}

export function readDatabase(): Database {
  if (!fs.existsSync(DB_FILE)) {
    writeDatabase(EMPTY);
    return { files: [], links: [] };
  }
  try {
    return normalize(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  } catch (error) {
    console.error('Error reading database file:', error);
    return { files: [], links: [] };
  }
}

/**
 * Atomic write: temp file plus rename, so a crash mid-write cannot leave a
 * truncated index behind. Losing the index means every share link 404s.
 */
export function writeDatabase(data: Database): void {
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DB_FILE);
  } catch (error) {
    console.error('Error writing database file:', error);
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* best effort */
    }
  }
}

/** Read, mutate, persist. Keeps call sites from forgetting the write. */
export function updateDatabase<T>(mutate: (db: Database) => T): T {
  const db = readDatabase();
  const result = mutate(db);
  writeDatabase(db);
  return result;
}

export function findItem(db: Database, id: string): StoredItem | undefined {
  return db.files.find((item) => item.id === id);
}

export function totalStorageUsed(): number {
  return readDatabase().files.reduce((sum, item) => sum + (item.size || 0), 0);
}

/**
 * One-time migration: older deployments kept db.json at the project root. A
 * legacy *directory* at that path is the symptom of the old broken bind mount
 * and is skipped on purpose.
 */
export function migrateLegacyDatabase(): void {
  if (fs.existsSync(DB_FILE) || !fs.existsSync(LEGACY_DB_FILE)) return;
  try {
    if (!fs.statSync(LEGACY_DB_FILE).isFile()) {
      console.warn('[startup] Ignoring legacy db.json: it is a directory, not a file.');
      return;
    }
    writeDatabase(normalize(JSON.parse(fs.readFileSync(LEGACY_DB_FILE, 'utf8'))));
    console.log('[startup] Migrated legacy db.json into', DB_FILE);
  } catch (error) {
    console.warn('[startup] Could not migrate legacy db.json:', (error as Error).message);
  }
}

/**
 * Self-heal: rebuild entries for uploads that exist on disk but are missing
 * from an empty index. Runs only while the index has no records, so it can
 * never duplicate or overwrite live data. Directories holding anything other
 * than exactly one file are ambiguous (folder uploads) and are left alone.
 */
export function reindexOrphanUploads(): void {
  const db = readDatabase();
  if (db.files.length > 0) return;

  const recovered: StoredFile[] = [];

  for (const entry of fs.readdirSync(UPLOADS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || RESERVED_DIRS.has(entry.name)) continue;

    const dir = path.join(UPLOADS_DIR, entry.name);
    const files = fs.readdirSync(dir, { withFileTypes: true }).filter((f) => f.isFile());
    const only = files[0];
    if (files.length !== 1 || !only) continue;

    const stat = fs.statSync(path.join(dir, only.name));
    recovered.push({
      id: entry.name,
      name: only.name,
      type: 'file',
      size: stat.size,
      mimeType: 'application/octet-stream',
      uploadedAt: stat.mtime.toISOString(),
      downloads: 0,
    });
  }

  if (recovered.length === 0) return;
  db.files.push(...recovered);
  writeDatabase(db);
  console.log(`[startup] Re-indexed ${recovered.length} orphaned upload(s) from disk.`);
}

/** Verifies the index is readable and the data dirs are writable. */
export function checkHealth(): { items: number } {
  const db = readDatabase();
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
  fs.accessSync(UPLOADS_DIR, fs.constants.W_OK);
  return { items: db.files.length };
}

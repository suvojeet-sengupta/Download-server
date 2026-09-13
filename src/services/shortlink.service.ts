import { readDatabase, writeDatabase } from '../db/database';
import type { Database, ShortLink } from '../types/domain';
import { randomBase62 } from '../utils/ids';

/** Every short code carries this prefix so the catch-all route can spot one. */
export const SHORT_PREFIX = 'suvo';

const MAX_ATTEMPTS = 100;

export function normalizeLongUrl(raw: string): string {
  const trimmed = raw.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function codeExists(db: Database, code: string): boolean {
  return db.links.some((link) => link.id === code);
}

/** Generates an unused `suvo` + base62 code, or null if it cannot find one. */
export function generateCode(db: Database): string | null {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = `${SHORT_PREFIX}${randomBase62(3)}`;
    if (!codeExists(db, candidate)) return candidate;
  }
  return null;
}

/**
 * Resolves a code and records the click in one step. Returns null when the code
 * is unknown, which both redirect routes render as a 404 page.
 */
export function consumeClick(code: string): ShortLink | null {
  const db = readDatabase();
  const link = db.links.find((l) => l.id === code);
  if (!link) return null;
  link.clicks = (link.clicks || 0) + 1;
  writeDatabase(db);
  return link;
}

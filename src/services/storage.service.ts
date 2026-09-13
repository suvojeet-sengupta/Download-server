import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/env';
import { UPLOADS_DIR } from '../config/paths';
import { totalStorageUsed } from '../db/database';

export interface CapacityVerdict {
  allowed: boolean;
  message?: string;
}

/** Rejects an incoming upload that would push total usage past the ceiling. */
export function checkCapacity(incomingBytes: number): CapacityVerdict {
  const incoming = Number.isFinite(incomingBytes) ? incomingBytes : 0;
  if (totalStorageUsed() + incoming <= config.maxStorageBytes) return { allowed: true };
  return {
    allowed: false,
    message: `Storage capacity full: ${config.maxStorageGb} GB limit reached.`,
  };
}

export function itemDir(id: string): string {
  return path.join(UPLOADS_DIR, id);
}

export function zipPath(id: string): string {
  return path.join(UPLOADS_DIR, `${id}.zip`);
}

/** Removes an upload directory and any cached ZIP. Never throws. */
export function removeItemFromDisk(id: string): void {
  for (const target of [itemDir(id), zipPath(id)]) {
    if (!fs.existsSync(target)) continue;
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch (error) {
      console.error(`Failed to delete ${target}:`, error);
    }
  }
}

/**
 * Accepts a user-supplied display name and strips anything that could escape
 * the share directory or confuse the filesystem. Returns null when nothing
 * usable survives, which callers reject as a 400.
 */
export function sanitizeFileName(raw: string): string | null {
  const trimmed = raw
    // Directory separators would let a name escape its share directory.
    .replace(/[/\\]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    // Collapse leading dot runs so "../../x" cannot land as "....x".
    .replace(/^\.+/, '')
    .trim();

  if (!trimmed || trimmed === '.' || trimmed === '..') return null;
  return trimmed.slice(0, 255);
}

export function discardTempFile(filePath: string | undefined): void {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* best effort */
  }
}
